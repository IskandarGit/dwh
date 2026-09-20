package com.greenwhite.dwh.instance.kauth;

import com.greenwhite.dwh.instance.audit.repository.AuditLogRepository;
import com.greenwhite.dwh.instance.audit.service.AuditDataRedactor;
import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.security.SecurityContext.KauthPrincipal;
import com.greenwhite.dwh.instance.kauth.repository.*;
import com.greenwhite.dwh.instance.kauth.service.*;
import com.greenwhite.dwh.instance.md.repository.*;
import com.greenwhite.dwh.instance.md.service.*;
import com.greenwhite.dwh.instance.search.SearchChangePublisher;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.ObjectMapper;

import javax.sql.DataSource;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/** Real JDBC and Spring transactions; hooks surround real operations, only delivery/indexing are faked. */
final class AuthenticationGenerationFixture implements AutoCloseable {
    static final String OLD_PASSWORD = "Initial-Synthetic-2026!"; // gitleaks:allow -- isolated fixture
    static final String NEW_PASSWORD = "Replacement-Synthetic-2026!"; // gitleaks:allow -- isolated fixture
    static final String OTHER_PASSWORD = "Concurrent-Synthetic-2026!"; // gitleaks:allow -- isolated fixture
    final JdbcClient jdbc;
    final ObjectMapper mapper = new ObjectMapper();
    final HookedUsers users;
    final HookedSessions sessions;
    final HookedTokens tokens;
    final HookedOtps otps;
    final HookedHasher hasher = new HookedHasher();
    final KauthChannelRepository channels;
    final Map<Long,String> deliveredCodes = new ConcurrentHashMap<>();
    final AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
    final MdUserService userService;
    final KauthAuthService auth;
    final KauthApiTokenService api;
    final KauthChannelService channel;
    final UserSessionInvalidator invalidator;
    final MdPermissionService permissions;
    volatile boolean failAfterAudit;

    AuthenticationGenerationFixture(DataSource ds) {
        jdbc = JdbcClient.create(ds);
        users = new HookedUsers(jdbc,mapper);
        sessions = new HookedSessions(jdbc);
        tokens = new HookedTokens(jdbc);
        otps = new HookedOtps(jdbc);
        channels = new KauthChannelRepository(jdbc);
        var audit = new AuditLogService(new AuditLogRepository(jdbc,mapper),null,new AuditDataRedactor()) {
            @Override public void logSecurityEvent(String event,Long userId,String ip,String agent,Map<String,Object> details) {
                super.logSecurityEvent(event,userId,ip,agent,details);
                if (failAfterAudit && event.equals("PASSWORD_CHANGED")) throw new IllegalStateException("synthetic audit failure");
            }
        };
        permissions = new MdPermissionService(new MdPermissionRepository(jdbc));
        var scopes = new MdScopeService(new MdScopeRepository(jdbc),new MdOrgUnitRepository(jdbc),permissions,audit);
        var sender = new KauthOtpSender(null) {
            @Override public void sendLoginCode(KauthChannelRepository.ChannelRecord c,String code) { deliveredCodes.put(c.userId(),code); }
            @Override public void sendVerificationCode(KauthChannelRepository.ChannelRecord c,String code) { deliveredCodes.put(c.userId(),code); }
        };
        context.register(Transactions.class);
        context.registerBean(DataSource.class,() -> ds);
        context.registerBean(JdbcClient.class,() -> jdbc);
        context.registerBean(ObjectMapper.class,() -> mapper);
        context.registerBean(AuditLogService.class,() -> audit);
        context.registerBean(MdPermissionService.class,() -> permissions);
        context.registerBean(KauthSessionService.class,() -> new KauthSessionService(sessions));
        context.registerBean(PlatformTransactionManager.class,() -> new DataSourceTransactionManager(ds));
        context.registerBean(KauthUserSessionInvalidator.class,() -> new KauthUserSessionInvalidator(sessions,tokens,users));
        context.registerBean(MdUserService.class,() -> new MdUserService(users,new MdRoleRepository(jdbc),
                new MdCustomFieldService(new MdCustomFieldRepository(jdbc,mapper),audit),hasher,new PasswordValidator(),
                context.getBean(UserSessionInvalidator.class),mock(SearchChangePublisher.class),audit,scopes));
        var guard=new KauthCredentialGuard(sessions,tokens);
        context.registerBean(KauthApiTokenService.class,() -> new KauthApiTokenService(tokens,guard));
        context.registerBean(KauthChannelService.class,() -> new KauthChannelService(channels,otps,sender,audit,guard));
        context.registerBean(KauthAuthService.class,() -> new KauthAuthService(context.getBean(MdUserService.class),sessions,new KauthLoginAttemptRepository(jdbc),
                otps,new KauthPasswordResetRepository(jdbc),hasher,new PasswordValidator(),audit,
                context.getBean(KauthChannelService.class),sender));
        context.refresh();
        userService=context.getBean(MdUserService.class);
        invalidator=context.getBean(UserSessionInvalidator.class);
        auth=context.getBean(KauthAuthService.class);
        api=context.getBean(KauthApiTokenService.class);
        channel=context.getBean(KauthChannelService.class);
    }

    Long user(boolean forced,boolean twoFactor) {
        String login="generation_"+UUID.randomUUID();
        long id=jdbc.sql("""
                insert into md_users(name,login,email,password_hash,force_password_change,is_2fa_enabled)
                values (:login,:login,:login,:hash,:forced,:twoFactor) returning id
                """).param("login",login).param("hash",hasher.hashPassword(OLD_PASSWORD))
                .param("forced",forced).param("twoFactor",twoFactor).query(Long.class).single();
        if(twoFactor)channels.bindOrUpdate(id,"telegram","synthetic-"+id,true);
        return id;
    }

    KauthPrincipal principal(Long id,boolean bearer) {
        var user=users.findById(id).orElseThrow();
        if(bearer){
            var token=tokens.create(id,user.authenticationVersion(),"test","test",UUID.randomUUID().toString(),null);
            return new KauthPrincipal(id,user.login(),user.email(),null,true,Set.of(),1,user.forcePasswordChange(),user.authenticationVersion(),token.id());
        }
        var session=sessions.create(id,user.authenticationVersion(),UUID.randomUUID().toString(),"127.0.0.1","test","test");
        return new KauthPrincipal(id,user.login(),user.email(),session.id(),false,Set.of(),1,user.forcePasswordChange(),user.authenticationVersion(),null);
    }

    KauthAuthService.LoginResult login(Long id,String password) {
        return auth.login(users.findById(id).orElseThrow().login(),password,"127.0.0.1","test","test");
    }

    long count(String table,Long id,String condition) {
        return jdbc.sql("select count(*) from "+table+" where user_id=:id and "+condition).param("id",id).query(Long.class).single();
    }

    @Override public void close(){context.close();}

    @Configuration(proxyBeanMethods=false) @EnableTransactionManagement static class Transactions {}

    static class HookedUsers extends MdUserRepository {
        volatile Consumer<UserRecord> afterRead = ignored -> {};
        HookedUsers(JdbcClient jdbc,ObjectMapper mapper){super(jdbc,mapper);}
        @Override public Optional<UserRecord> findById(Long id){
            var result=super.findById(id); result.ifPresent(afterRead); return result;
        }
    }
    static class HookedHasher extends KauthPasswordHasher {
        volatile Runnable afterVerified=() -> {};
        @Override public boolean verifyPassword(String raw,String hash){
            boolean verified=super.verifyPassword(raw,hash);
            if(verified)afterVerified.run();
            return verified;
        }
    }
    static class HookedSessions extends KauthSessionRepository {
        volatile Consumer<SessionRecord> afterInsert=ignored -> {};
        volatile Consumer<SessionRecord> afterProof=ignored -> {};
        volatile Consumer<SessionRecord> afterHashProof=ignored -> {};
        volatile boolean failInsert;
        volatile boolean failClose;
        HookedSessions(JdbcClient jdbc){super(jdbc);}
        @Override public void close(Long id){
            if(failClose)throw new IllegalStateException("synthetic session close failure");
            super.close(id);
        }
        @Override public SessionRecord create(Long id,long version,String hash,String ip,String ua,String device){
            if(failInsert)throw new IllegalStateException("synthetic session insert failure");
            var result=super.create(id,version,hash,ip,ua,device);afterInsert.accept(result);return result;
        }
        @Override public Optional<SessionRecord> findActiveById(Long id){
            var result=super.findActiveById(id);result.ifPresent(afterProof);return result;
        }
        @Override public Optional<SessionRecord> findActiveByTokenHash(String hash){
            var result=super.findActiveByTokenHash(hash);result.ifPresent(afterHashProof);return result;
        }
    }
    static class HookedTokens extends KauthApiTokenRepository {
        volatile Consumer<ApiTokenRecord> afterInsert=ignored -> {};
        volatile Consumer<ApiTokenRecord> afterProof=ignored -> {};
        volatile Consumer<ApiTokenRecord> afterHashProof=ignored -> {};
        volatile boolean failAfterRevoke;
        HookedTokens(JdbcClient jdbc){super(jdbc);}
        @Override public ApiTokenRecord create(Long id,long version,String name,String prefix,String hash,Instant expiry){
            var result=super.create(id,version,name,prefix,hash,expiry);afterInsert.accept(result);return result;
        }
        @Override public Optional<ApiTokenRecord> findActiveById(Long id){
            var result=super.findActiveById(id);result.ifPresent(afterProof);return result;
        }
        @Override public Optional<ApiTokenRecord> findActiveByTokenHash(String hash){
            var result=super.findActiveByTokenHash(hash);result.ifPresent(afterHashProof);return result;
        }
        @Override public void revokeAllUserTokens(Long id){
            super.revokeAllUserTokens(id);
            if(failAfterRevoke)throw new IllegalStateException("synthetic revocation failure");
        }
    }
    static class HookedOtps extends KauthOtpCodeRepository {
        volatile Consumer<OtpRecord> afterProof=ignored -> {};
        volatile Consumer<OtpRecord> afterInsert=ignored -> {};
        HookedOtps(JdbcClient jdbc){super(jdbc);}
        @Override public Optional<OtpRecord> findActiveByTokenHash(String hash,String purpose){
            var result=super.findActiveByTokenHash(hash,purpose);result.ifPresent(afterProof);return result;
        }
        @Override public OtpRecord create(Long id,long version,String channel,String codeHash,String tokenHash,String purpose,Instant expiry){
            var result=super.create(id,version,channel,codeHash,tokenHash,purpose,expiry);afterInsert.accept(result);return result;
        }
    }

    static void requireTransaction(){assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();}
}

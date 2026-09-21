package com.greenwhite.dwh.instance.kauth;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.config.db.FlywayUtcConfiguration;
import com.greenwhite.dwh.instance.common.security.SecurityContext.KauthPrincipal;
import com.greenwhite.dwh.instance.kauth.service.KauthAuthService;
import com.greenwhite.dwh.instance.kauth.service.KauthPasswordHasher;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.Arguments;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import javax.sql.DataSource;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;
import java.util.UUID;
import java.util.stream.Stream;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

import static com.greenwhite.dwh.instance.kauth.AuthenticationGenerationFixture.*;
import static org.assertj.core.api.Assertions.*;

@Testcontainers
class AuthenticationGenerationConcurrencyTest {
    @Container static PostgreSQLContainer<?> postgres=new PostgreSQLContainer<>("postgres:18-alpine");
    static DataSource ds;
    @BeforeAll static void migrate(){
        ds=new DriverManagerDataSource(postgres.getJdbcUrl(),postgres.getUsername(),postgres.getPassword());
        FlywayUtcConfiguration.configure(Flyway.configure()).dataSource(ds).locations("classpath:db/migration").load().migrate();
    }

    @Test void simultaneousPasswordChangesCommitOnlyWinnerHashOneBumpAndOneAudit() throws Exception {
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(false,false);
            var bothRead=new CountDownLatch(2);
            var release=new CountDownLatch(1);
            var executor=Executors.newFixedThreadPool(2,r -> new Thread(r,"password-racer"));
            f.users.afterRead=user -> {
                if(Thread.currentThread().getName().equals("password-racer")){
                    requireTransaction();bothRead.countDown();await(release);
                }
            };
            try {
                var first=executor.submit(() -> change(f,id,NEW_PASSWORD));
                var second=executor.submit(() -> change(f,id,OTHER_PASSWORD));
                assertThat(bothRead.await(10,TimeUnit.SECONDS)).isTrue();
                release.countDown();
                var outcomes=List.of(first.get(20,TimeUnit.SECONDS),second.get(20,TimeUnit.SECONDS));
                assertThat(outcomes.stream().filter(Outcome::success).count()).isEqualTo(1);
                assertThat(outcomes.stream().filter(o -> o.code()==ErrorCode.INVALID_CREDENTIALS).count()).isEqualTo(1);
                var user=f.users.findById(id).orElseThrow();
                String winner=outcomes.getFirst().success()?NEW_PASSWORD:OTHER_PASSWORD;
                String loser=outcomes.getFirst().success()?OTHER_PASSWORD:NEW_PASSWORD;
                assertThat(f.hasher.verifyPassword(winner,user.passwordHash())).isTrue();
                assertThat(f.hasher.verifyPassword(loser,user.passwordHash())).isFalse();
                assertThat(user.authenticationVersion()).isEqualTo(1);
                assertThat(f.count("security_events",id,"event_type='PASSWORD_CHANGED'")).isEqualTo(1);
            } finally {release.countDown();stop(executor);}
        }
    }

    @ParameterizedTest @ValueSource(booleans={false,true})
    void auditFailureRollsBackRealPasswordRevocationsAndGeneration(boolean forced){
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(forced,false);
            var cookie=f.principal(id,false);
            var bearer=f.principal(id,true);
            f.failAfterAudit=true;
            assertThatThrownBy(() -> f.userService.changePassword(id,0,OLD_PASSWORD,NEW_PASSWORD))
                    .isInstanceOf(IllegalStateException.class).hasMessage("synthetic audit failure");
            var user=f.users.findById(id).orElseThrow();
            assertThat(f.hasher.verifyPassword(OLD_PASSWORD,user.passwordHash())).isTrue();
            assertThat(user.forcePasswordChange()).isEqualTo(forced);
            assertThat(user.authenticationVersion()).isZero();
            assertThat(f.sessions.findActiveById(cookie.sessionId()).isPresent()).isTrue();
            assertThat(f.tokens.findActiveById(bearer.apiTokenId()).isPresent()).isTrue();
            assertThat(f.count("security_events",id,"event_type='PASSWORD_CHANGED'")).isZero();
        }
    }

    @Test void standaloneInvalidatorRollsBackItsRealRevocationWrites(){
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(false,false);
            var cookie=f.principal(id,false);
            var bearer=f.principal(id,true);
            f.tokens.failAfterRevoke=true;
            assertThatThrownBy(() -> f.invalidator.invalidateAllAccess(id))
                    .isInstanceOf(IllegalStateException.class).hasMessage("synthetic revocation failure");
            assertThat(f.users.findById(id).orElseThrow().authenticationVersion()).isZero();
            assertThat(f.sessions.findActiveById(cookie.sessionId()).isPresent()).isTrue();
            assertThat(f.tokens.findActiveById(bearer.apiTokenId()).isPresent()).isTrue();
        }
    }

    @Test void oldPrincipalCannotChangePasswordEvenKnowingTheNewPassword(){
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(false,false);
            f.userService.changePassword(id,0,OLD_PASSWORD,NEW_PASSWORD);
            assertThatThrownBy(() -> f.userService.changePassword(id,0,NEW_PASSWORD,OTHER_PASSWORD))
                    .isInstanceOfSatisfying(ApiException.class,e -> assertThat(e.getErrorCode()).isEqualTo(ErrorCode.INVALID_CREDENTIALS));
            assertThat(f.users.findById(id).orElseThrow().authenticationVersion()).isEqualTo(1);
            assertThat(f.count("security_events",id,"event_type='PASSWORD_CHANGED'")).isEqualTo(1);
        }
    }

    @ParameterizedTest @ValueSource(booleans={false,true})
    void individuallyRevokedProofCannotMintApiTokens(boolean bearer){
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(false,false);
            var proof=f.principal(id,bearer);
            if(bearer)f.tokens.revoke(proof.apiTokenId(),id);else f.sessions.close(proof.sessionId());
            assertThatThrownBy(() -> f.api.createToken(proof,"test",null))
                    .isInstanceOfSatisfying(ApiException.class,e -> assertThat(e.getErrorCode()).isEqualTo(ErrorCode.INVALID_CREDENTIALS));
            assertThat(f.users.findById(id).orElseThrow().authenticationVersion()).isZero();
        }
    }

    @ParameterizedTest @ValueSource(booleans={false,true})
    void wrongOwnerOrMalformedProofCannotMintApiTokens(boolean bearer){
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(false,false),other=f.user(false,false);
            var valid=f.principal(id,bearer);
            var wrongOwner=new KauthPrincipal(other,"test","test",valid.sessionId(),bearer,Set.of(),1,false,0,valid.apiTokenId());
            var noId=new KauthPrincipal(id,"test","test",null,bearer,Set.of(),1,false,0,null);
            var bothIds=new KauthPrincipal(id,"test","test",1L,bearer,Set.of(),1,false,0,1L);
            var wrongKind=new KauthPrincipal(id,"test","test",valid.sessionId(),!bearer,Set.of(),1,false,0,valid.apiTokenId());
            for(var proof:List.of(wrongOwner,noId,bothIds,wrongKind)){
                assertThatThrownBy(() -> f.api.createToken(proof,"test",null))
                        .isInstanceOfSatisfying(ApiException.class,e -> assertThat(e.getErrorCode()).isEqualTo(ErrorCode.INVALID_CREDENTIALS));
            }
        }
    }

    @Test void simultaneousCorrectOtpClaimsIssueOnlyOneSession() throws Exception {
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(false,true);
            var login=f.login(id,OLD_PASSWORD);
            String code=f.deliveredCodes.get(id);
            var bothRead=new CountDownLatch(2);
            var release=new CountDownLatch(1);
            var executor=Executors.newFixedThreadPool(2);
            f.otps.afterProof=otp -> {requireTransaction();bothRead.countDown();await(release);};
            try {
                Callable<Outcome> verify=() -> {
                    try {f.auth.verifyOtp(login.otpToken(),code,"127.0.0.1","test","test");return new Outcome(true,null);}
                    catch(ApiException e){return new Outcome(false,e.getErrorCode());}
                };
                var first=executor.submit(verify);var second=executor.submit(verify);
                assertThat(bothRead.await(10,TimeUnit.SECONDS)).isTrue();release.countDown();
                var results=List.of(first.get(20,TimeUnit.SECONDS),second.get(20,TimeUnit.SECONDS));
                assertThat(results.stream().filter(Outcome::success).count()).isEqualTo(1);
                assertThat(results.stream().filter(r -> r.code()==ErrorCode.OTP_INVALID).count()).isEqualTo(1);
                assertThat(f.count("kauth_sessions",id,"closed_at is null")).isEqualTo(1);
                assertThat(f.count("kauth_otp_codes",id,"is_used")).isEqualTo(1);
            } finally {release.countDown();stop(executor);}
        }
    }

    @Test void sessionInsertFailureRollsBackOtpClaim(){
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(false,true);
            var login=f.login(id,OLD_PASSWORD);
            String code=f.deliveredCodes.get(id);
            f.sessions.failInsert=true;
            assertThatThrownBy(() -> f.auth.verifyOtp(login.otpToken(),code,"127.0.0.1","test","test"))
                    .isInstanceOf(IllegalStateException.class).hasMessage("synthetic session insert failure");
            assertThat(f.count("kauth_otp_codes",id,"is_used")).isZero();
            f.sessions.failInsert=false;
            var result=f.auth.verifyOtp(login.otpToken(),code,"127.0.0.1","test","test");
            assertThat(f.sessions.findActiveByTokenHash(KauthPasswordHasher.sha256(result.rawSessionCookie())).isPresent()).isTrue();
        }
    }

    @Test void otpReadBeforePasswordCommitCannotCreateSessionAfterCommit() throws Exception {
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(false,true);
            var login=f.login(id,OLD_PASSWORD);
            String code=f.deliveredCodes.get(id);
            var captured=new CountDownLatch(1);var release=new CountDownLatch(1);
            var executor=Executors.newSingleThreadExecutor();
            f.otps.afterProof=otp -> {requireTransaction();captured.countDown();await(release);};
            try {
                var pending=executor.submit(() -> {
                    try {f.auth.verifyOtp(login.otpToken(),code,"127.0.0.1","test","test");return new Outcome(true,null);}
                    catch(ApiException e){return new Outcome(false,e.getErrorCode());}
                });
                assertThat(captured.await(10,TimeUnit.SECONDS)).isTrue();
                f.userService.changePassword(id,0,OLD_PASSWORD,NEW_PASSWORD);
                release.countDown();
                var result=pending.get(20,TimeUnit.SECONDS);
                assertThat(result.success()).isFalse();
                assertThat(result.code()).isEqualTo(ErrorCode.OTP_INVALID);
                assertThat(f.sessions.findActiveByUserId(id).isEmpty()).isTrue();
                assertThat(f.otps.findActiveByTokenHash(KauthPasswordHasher.sha256(login.otpToken()),"login").isEmpty()).isTrue();
            } finally {release.countDown();stop(executor);}
        }
    }

    enum Issuance { PASSWORD_LOGIN, LOGIN_OTP, VERIFY_OTP, API_COOKIE, API_BEARER }

    @ParameterizedTest @EnumSource(Issuance.class)
    void proofCapturedBeforePasswordCommitCannotIssueCurrentAccess(Issuance issuance) throws Exception {
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(false,issuance==Issuance.LOGIN_OTP || issuance==Issuance.VERIFY_OTP);
            var operation=prepare(f,id,OLD_PASSWORD,issuance);
            var captured=new CountDownLatch(1);var release=new CountDownLatch(1);
            var executor=Executors.newSingleThreadExecutor(r -> new Thread(r,"issuance-racer"));
            Runnable pause=() -> {if(Thread.currentThread().getName().equals("issuance-racer")){
                requireTransaction();captured.countDown();await(release);
            }};
            switch(issuance){
                case PASSWORD_LOGIN,LOGIN_OTP -> f.hasher.afterVerified=pause;
                case VERIFY_OTP -> f.otps.afterProof=ignored -> pause.run();
                case API_COOKIE -> f.sessions.afterProof=ignored -> pause.run();
                case API_BEARER -> f.tokens.afterProof=ignored -> pause.run();
            }
            try {
                var pending=executor.submit(operation::get);
                assertThat(captured.await(10,TimeUnit.SECONDS)).isTrue();
                f.userService.changePassword(id,0,OLD_PASSWORD,NEW_PASSWORD);
                release.countDown();
                var result=pending.get(20,TimeUnit.SECONDS);
                assertThat(result.code).isEqualTo(issuance==Issuance.VERIFY_OTP?ErrorCode.OTP_INVALID:ErrorCode.INVALID_CREDENTIALS);
                assertThat(result.raw==null).isTrue();
                assertThat(f.sessions.findActiveByUserId(id).isEmpty()).isTrue();
            } finally {release.countDown();stop(executor);}
        }
    }

    @ParameterizedTest @EnumSource(Issuance.class)
    void overlappingInsertCanCommitOnlyAnUnusableOldGenerationCredential(Issuance issuance) throws Exception {
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(false,issuance==Issuance.LOGIN_OTP || issuance==Issuance.VERIFY_OTP);
            var operation=prepare(f,id,OLD_PASSWORD,issuance);
            var inserted=new CountDownLatch(1);var release=new CountDownLatch(1);
            var executor=Executors.newSingleThreadExecutor();
            Runnable pause=() -> {requireTransaction();inserted.countDown();await(release);};
            switch(issuance){
                case PASSWORD_LOGIN,VERIFY_OTP -> f.sessions.afterInsert=ignored -> pause.run();
                case LOGIN_OTP -> f.otps.afterInsert=ignored -> pause.run();
                case API_COOKIE,API_BEARER -> f.tokens.afterInsert=ignored -> pause.run();
            }
            try {
                var pending=executor.submit(operation::get);
                assertThat(inserted.await(10,TimeUnit.SECONDS)).isTrue();
                f.userService.changePassword(id,0,OLD_PASSWORD,NEW_PASSWORD);
                assertThat(f.users.findById(id).orElseThrow().authenticationVersion()).isEqualTo(1);
                release.countDown();
                var result=pending.get(20,TimeUnit.SECONDS);
                assertThat(result.code).isNull();
                assertThat(result.raw!=null).isTrue();
                assertThat(active(f,result,issuance)).isFalse();
                assertThat(f.sessions.findActiveByUserId(id).isEmpty()).isTrue();
                if(issuance==Issuance.LOGIN_OTP){
                    assertThatThrownBy(() -> f.auth.verifyOtp(result.raw,f.deliveredCodes.get(id),"127.0.0.1","test","test"))
                            .isInstanceOfSatisfying(ApiException.class,e -> assertThat(e.getErrorCode()).isEqualTo(ErrorCode.OTP_INVALID));
                }
            } finally {release.countDown();stop(executor);}
        }
    }

    @ParameterizedTest @EnumSource(Issuance.class)
    void issuedAccessIsRevokedAndFreshProofAfterCommitUsesNewGeneration(Issuance issuance){
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(false,issuance==Issuance.LOGIN_OTP || issuance==Issuance.VERIFY_OTP);
            var issued=prepare(f,id,OLD_PASSWORD,issuance).get();
            assertThat(issued.code).isNull();assertThat(active(f,issued,issuance)).isTrue();
            f.userService.changePassword(id,0,OLD_PASSWORD,NEW_PASSWORD);
            assertThat(active(f,issued,issuance)).isFalse();
            var fresh=prepare(f,id,NEW_PASSWORD,issuance).get();
            assertThat(fresh.code).isNull();assertThat(active(f,fresh,issuance)).isTrue();
            String hash=KauthPasswordHasher.sha256(fresh.raw);
            long version=switch(issuance){
                case PASSWORD_LOGIN,VERIFY_OTP -> f.sessions.findActiveByTokenHash(hash).orElseThrow().authenticationVersion();
                case LOGIN_OTP -> f.otps.findActiveByTokenHash(hash,"login").orElseThrow().authenticationVersion();
                case API_COOKIE,API_BEARER -> f.tokens.findActiveByTokenHash(hash).orElseThrow().authenticationVersion();
            };
            assertThat(version).isEqualTo(1);
        }
    }

    static Stream<Arguments> identityRaces(){
        return Stream.of(Issuance.PASSWORD_LOGIN,Issuance.LOGIN_OTP,Issuance.VERIFY_OTP)
                .flatMap(i -> Stream.of(Arguments.of(i,false,false),Arguments.of(i,false,true),
                        Arguments.of(i,true,false),Arguments.of(i,true,true)));
    }

    @ParameterizedTest @MethodSource("identityRaces")
    void blockUnblockAndAnonymizationRejectConcurrentOldAccessWithoutAffectingOthers(
            Issuance issuance,boolean anonymize,boolean afterInsert) throws Exception {
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(false,issuance!=Issuance.PASSWORD_LOGIN),other=f.user(false,false);
            var oldCookie=f.principal(id,false);var oldBearer=f.principal(id,true);
            var otherCookie=f.principal(other,false);var otherBearer=f.principal(other,true);
            String oldOtpHash=UUID.randomUUID().toString();
            f.otps.create(id,0,"telegram","synthetic",oldOtpHash,"login",java.time.Instant.now().plusSeconds(300));
            var operation=prepare(f,id,OLD_PASSWORD,issuance);
            var captured=new CountDownLatch(1);var release=new CountDownLatch(1);
            var executor=Executors.newFixedThreadPool(2,r -> new Thread(r,"identity-racer"));
            var issuerPid=new AtomicLong();
            Runnable pause=() -> {if(Thread.currentThread().getName().equals("identity-racer")){
                requireTransaction();issuerPid.set(f.jdbc.sql("select pg_backend_pid()").query(Long.class).single());
                captured.countDown();await(release);
            }};
            if(afterInsert){
                if(issuance==Issuance.LOGIN_OTP)f.otps.afterInsert=ignored -> pause.run();
                else f.sessions.afterInsert=ignored -> pause.run();
            } else if(issuance==Issuance.VERIFY_OTP)f.otps.afterProof=ignored -> pause.run();
            else f.hasher.afterVerified=pause;
            try {
                var pending=executor.submit(operation::get);
                assertThat(captured.await(10,TimeUnit.SECONDS)).isTrue();
                Future<?> revocation=null;
                if(anonymize && afterInsert){
                    // Unique login/email changes acquire an UPDATE lock, which waits on the INSERT's FK lock.
                    var revokerRead=new CountDownLatch(1);var revokerPid=new AtomicLong();
                    f.users.afterRead=user -> {if(Thread.currentThread().getName().equals("anonymizer")){
                        requireTransaction();revokerPid.set(f.jdbc.sql("select pg_backend_pid()").query(Long.class).single());
                        revokerRead.countDown();
                    }};
                    revocation=executor.submit(() -> {
                        Thread.currentThread().setName("anonymizer");f.userService.anonymizeUser(id,other);
                    });
                    assertThat(revokerRead.await(10,TimeUnit.SECONDS)).isTrue();
                    assertBlockedBy(f,revokerPid.get(),issuerPid.get());
                } else if(anonymize)f.userService.anonymizeUser(id,other);
                else {f.userService.setUserState(id,"P",other);f.userService.setUserState(id,"A",other);}
                release.countDown();
                var result=pending.get(20,TimeUnit.SECONDS);
                if(revocation!=null)revocation.get(20,TimeUnit.SECONDS);
                if(afterInsert){assertThat(result.code).isNull();assertThat(result.raw!=null).isTrue();}
                else assertThat(result.code).isEqualTo(issuance==Issuance.VERIFY_OTP?ErrorCode.OTP_INVALID:ErrorCode.INVALID_CREDENTIALS);
                assertThat(active(f,result,issuance)).isFalse();
                assertThat(f.sessions.findActiveById(oldCookie.sessionId()).isEmpty()).isTrue();
                assertThat(f.tokens.findActiveById(oldBearer.apiTokenId()).isEmpty()).isTrue();
                assertThat(f.otps.findActiveByTokenHash(oldOtpHash,"login").isEmpty()).isTrue();
                assertThat(f.jdbc.sql("select is_used from kauth_otp_codes where otp_token_hash=:hash")
                        .param("hash",oldOtpHash).query(Boolean.class).single()).isFalse();
                assertThat(f.users.findById(id).orElseThrow().authenticationVersion()).isEqualTo(1);
                assertThat(f.users.findById(other).orElseThrow().authenticationVersion()).isZero();
                assertThat(f.hasher.verifyPassword(OLD_PASSWORD,f.users.findById(other).orElseThrow().passwordHash())).isTrue();
                assertThat(f.sessions.findActiveById(otherCookie.sessionId()).isPresent()).isTrue();
                assertThat(f.tokens.findActiveById(otherBearer.apiTokenId()).isPresent()).isTrue();
            } finally {release.countDown();stop(executor);}
        }
    }

    @ParameterizedTest @ValueSource(booleans={false,true})
    void channelVerificationRejectsOldGenerationOwnerAndPurposeButAcceptsFreshCode(boolean bearer){
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(false,true),other=f.user(false,true);
            var oldProof=f.principal(id,bearer);
            String oldToken=f.channel.bindChannel(oldProof,"telegram","synthetic-old-address");
            String oldCode=f.deliveredCodes.get(id);
            f.userService.changePassword(id,0,OLD_PASSWORD,NEW_PASSWORD);
            var fresh=f.principal(id,bearer);
            assertOtpInvalid(() -> f.channel.confirmChannel(fresh,oldToken,oldCode));
            var otherProof=f.principal(other,bearer);
            String otherToken=f.channel.bindChannel(otherProof,"telegram","synthetic-other-address");
            assertOtpInvalid(() -> f.channel.confirmChannel(fresh,otherToken,f.deliveredCodes.get(other)));
            f.channels.bindOrUpdate(id,"telegram","synthetic-address",true);
            var login=f.login(id,NEW_PASSWORD);
            assertOtpInvalid(() -> f.channel.confirmChannel(fresh,login.otpToken(),f.deliveredCodes.get(id)));
            String freshToken=f.channel.bindChannel(fresh,"telegram","synthetic-new-address");
            String freshCode=f.deliveredCodes.get(id);
            f.channel.confirmChannel(fresh,freshToken,freshCode);
            assertThat(f.channels.findByUserIdAndChannel(id,"telegram").orElseThrow().isVerified()).isTrue();
            assertOtpInvalid(() -> f.channel.confirmChannel(fresh,freshToken,freshCode));
            if(bearer)f.tokens.revoke(fresh.apiTokenId(),id);else f.sessions.close(fresh.sessionId());
            assertThatThrownBy(() -> f.channel.bindChannel(fresh,"telegram","synthetic-revoked"))
                    .isInstanceOfSatisfying(ApiException.class,e -> assertThat(e.getErrorCode()).isEqualTo(ErrorCode.INVALID_CREDENTIALS));
            assertThatThrownBy(() -> f.channel.confirmChannel(fresh,freshToken,freshCode))
                    .isInstanceOfSatisfying(ApiException.class,e -> assertThat(e.getErrorCode()).isEqualTo(ErrorCode.INVALID_CREDENTIALS));
        }
    }

    @ParameterizedTest @ValueSource(booleans={false,true})
    void revocationFailureRollsBackNormalAndForcedPasswordChanges(boolean forced){
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(forced,false);
            var cookie=f.principal(id,false);var bearer=f.principal(id,true);
            f.tokens.failAfterRevoke=true;
            assertThatThrownBy(() -> f.userService.changePassword(id,0,OLD_PASSWORD,NEW_PASSWORD))
                    .isInstanceOf(IllegalStateException.class).hasMessage("synthetic revocation failure");
            var user=f.users.findById(id).orElseThrow();
            assertThat(f.hasher.verifyPassword(OLD_PASSWORD,user.passwordHash())).isTrue();
            assertThat(user.authenticationVersion()).isZero();
            assertThat(user.forcePasswordChange()).isEqualTo(forced);
            assertThat(f.sessions.findActiveById(cookie.sessionId()).isPresent()).isTrue();
            assertThat(f.tokens.findActiveById(bearer.apiTokenId()).isPresent()).isTrue();
            assertThat(f.count("security_events",id,"event_type='PASSWORD_CHANGED'")).isZero();
        }
    }

    @Test void missingUserAndVersionOverflowCannotPartiallyRevokeAccess(){
        try(var f=new AuthenticationGenerationFixture(ds)){
            assertThatThrownBy(() -> f.userService.incrementAuthenticationVersion(Long.MAX_VALUE)).isInstanceOf(ApiException.class);
            Long id=f.user(false,false);
            f.jdbc.sql("update md_users set auth_version=9223372036854775807 where id=:id").param("id",id).update();
            var cookie=f.principal(id,false);var bearer=f.principal(id,true);
            assertThatThrownBy(() -> f.userService.incrementAuthenticationVersion(id)).isInstanceOf(org.springframework.dao.DataAccessException.class);
            assertThat(f.users.findById(id).orElseThrow().authenticationVersion()).isEqualTo(Long.MAX_VALUE);
            assertThat(f.sessions.findActiveById(cookie.sessionId()).isPresent()).isTrue();
            assertThat(f.tokens.findActiveById(bearer.apiTokenId()).isPresent()).isTrue();
        }
    }

    @Test void closingCookieSessionsOrRevokingOneApiTokenDoesNotBumpOrRevokeOtherCredentialKinds(){
        try(var f=new AuthenticationGenerationFixture(ds)){
            Long id=f.user(false,true);
            var cookie=f.principal(id,false);var bearer=f.principal(id,true);var otherBearer=f.principal(id,true);
            var otp=f.login(id,OLD_PASSWORD);
            f.context.getBean(com.greenwhite.dwh.instance.kauth.service.KauthSessionService.class).closeAllUserSessions(id);
            assertThat(f.sessions.findActiveById(cookie.sessionId()).isEmpty()).isTrue();
            assertThat(f.tokens.findActiveById(bearer.apiTokenId()).isPresent()).isTrue();
            f.api.revokeToken(bearer.apiTokenId(),id);
            assertThat(f.tokens.findActiveById(bearer.apiTokenId()).isEmpty()).isTrue();
            assertThat(f.tokens.findActiveById(otherBearer.apiTokenId()).isPresent()).isTrue();
            assertThat(f.otps.findActiveByTokenHash(KauthPasswordHasher.sha256(otp.otpToken()),"login").isPresent()).isTrue();
            assertThat(f.users.findById(id).orElseThrow().authenticationVersion()).isZero();
        }
    }

    private static void assertOtpInvalid(Runnable operation){
        assertThatThrownBy(operation::run).isInstanceOfSatisfying(ApiException.class,e -> assertThat(e.getErrorCode()).isEqualTo(ErrorCode.OTP_INVALID));
    }

    private static void assertBlockedBy(AuthenticationGenerationFixture f,long waitingPid,long blockingPid){
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
        boolean blocked=false;
        while(!blocked && System.nanoTime()<deadline){
            blocked=f.jdbc.sql("select cast(:blocker as integer) = any(pg_blocking_pids(cast(:waiter as integer)))")
                    .param("blocker",blockingPid).param("waiter",waitingPid).query(Boolean.class).single();
        }
        assertThat(blocked).as("observed PostgreSQL foreign-key lock wait").isTrue();
    }

    private static Supplier<Attempt> prepare(AuthenticationGenerationFixture f,Long id,String password,Issuance issuance){
        String login=f.users.findById(id).orElseThrow().login();
        return switch(issuance){
            case PASSWORD_LOGIN,LOGIN_OTP -> () -> attempt(() -> {
                var result=f.auth.login(login,password,"127.0.0.1","test","test");
                return issuance==Issuance.LOGIN_OTP?result.otpToken():result.rawSessionCookie();
            });
            case VERIFY_OTP -> {
                var otp=f.login(id,password);String code=f.deliveredCodes.get(id);
                yield () -> attempt(() -> f.auth.verifyOtp(otp.otpToken(),code,"127.0.0.1","test","test").rawSessionCookie());
            }
            case API_COOKIE,API_BEARER -> {
                var proof=f.principal(id,issuance==Issuance.API_BEARER);
                yield () -> attempt(() -> f.api.createToken(proof,"test",null).rawSecretToken());
            }
        };
    }

    private static boolean active(AuthenticationGenerationFixture f,Attempt result,Issuance issuance){
        if(result.raw==null)return false;
        String hash=KauthPasswordHasher.sha256(result.raw);
        return switch(issuance){
            case PASSWORD_LOGIN,VERIFY_OTP -> f.sessions.findActiveByTokenHash(hash).isPresent();
            case LOGIN_OTP -> f.otps.findActiveByTokenHash(hash,"login").isPresent();
            case API_COOKIE,API_BEARER -> f.tokens.findActiveByTokenHash(hash).isPresent();
        };
    }

    private static Attempt attempt(Supplier<String> operation){
        try{return new Attempt(operation.get(),null);}
        catch(ApiException e){return new Attempt(null,e.getErrorCode());}
    }
    private static final class Attempt {
        final String raw;final ErrorCode code;
        Attempt(String raw,ErrorCode code){this.raw=raw;this.code=code;}
        @Override public String toString(){return "credential attempt (redacted)";}
    }

    private static Outcome change(AuthenticationGenerationFixture f,Long id,String replacement){
        try {f.userService.changePassword(id,0,OLD_PASSWORD,replacement);return new Outcome(true,null);}
        catch(ApiException e){return new Outcome(false,e.getErrorCode());}
    }
    private record Outcome(boolean success,ErrorCode code){}

    static void await(CountDownLatch latch){
        try {assertThat(latch.await(10,TimeUnit.SECONDS)).as("bounded race synchronization").isTrue();}
        catch(InterruptedException e){Thread.currentThread().interrupt();throw new AssertionError("race interrupted",e);}
    }
    static void stop(ExecutorService executor) throws InterruptedException {
        executor.shutdownNow();assertThat(executor.awaitTermination(10,TimeUnit.SECONDS)).isTrue();
    }
}

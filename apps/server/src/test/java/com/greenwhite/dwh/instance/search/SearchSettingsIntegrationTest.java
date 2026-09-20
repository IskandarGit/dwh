package com.greenwhite.dwh.instance.search;

import com.greenwhite.dwh.instance.audit.repository.AuditLogRepository;
import com.greenwhite.dwh.instance.audit.service.*;
import com.greenwhite.dwh.instance.common.security.RoleMembershipAuthorizer;
import com.greenwhite.dwh.instance.config.security.*;
import com.greenwhite.dwh.instance.kauth.repository.KauthSessionRepository;
import com.greenwhite.dwh.instance.kauth.security.KauthAuthenticationFilter;
import com.greenwhite.dwh.instance.kauth.service.*;
import com.greenwhite.dwh.instance.md.repository.MdUserRepository;
import com.greenwhite.dwh.instance.md.service.*;
import com.greenwhite.dwh.instance.search.controller.SearchController;
import com.greenwhite.dwh.instance.search.service.*;
import com.greenwhite.dwh.instance.search.typesense.*;
import com.sun.net.httpserver.HttpServer;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.*;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.testcontainers.containers.PostgreSQLContainer;
import tools.jackson.databind.ObjectMapper;
import javax.sql.DataSource;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CopyOnWriteArrayList;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class SearchSettingsIntegrationTest extends SearchSettingsIntegrationTestSupport {
    @Autowired com.greenwhite.dwh.instance.search.service.SearchSettingsService settings;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactions;

    @Test void savedLimitAboveTenReachesTheRealControllerAndEngineConsumer() throws Exception {
        authenticate(Set.of("*.*"), false);
        var current = readSettings();
        var policy = mapper.valueToTree(SearchQueryPolicy.defaults()).deepCopy();
        ((tools.jackson.databind.node.ObjectNode) policy).put("globalLimit", 14);
        mvc.perform(auth(put("/api/v1/search/settings")).content(saveJson(current.path("version").asLong(), policy)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.policy.globalLimit").value(14));
        mvc.perform(auth(get("/api/v1/search")).param("q", "delivery").param("entity", "TASK"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalHits").value(14));
        assertThat(requests.getLast()).contains("\"per_page\":14");
        mvc.perform(auth(put("/api/v1/search/settings")).content(saveJson(current.path("version").asLong(), policy)))
                .andExpect(status().isConflict());
        assertThat(readSettings().path("policy").path("globalLimit").asInt()).isEqualTo(14);
        assertThat(jdbc.sql("select count(*) from audit_log where table_name='search_settings' and changed_by=:actor")
                .param("actor",actorId).query(Long.class).single()).isOne();
    }

    @Test void invalidPolicyNeverPersistsOrReachesTheEngine() throws Exception {
        authenticate(Set.of("*.*"), false);
        var current = readSettings();
        for (String mutation : List.of("\"globalLimit\":0", "\"globalLimit\":51", "\"globalLimit\":null",
                "\"globalLimit\":1.5", "\"globalLimit\":\"12\"")) {
            String policy = mapper.writeValueAsString(SearchQueryPolicy.defaults()).replace("\"globalLimit\":10", mutation);
            mvc.perform(auth(put("/api/v1/search/settings")).content("{\"version\":"+current.path("version").asLong()+",\"policy\":"+policy+"}"))
                    .andExpect(status().isBadRequest());
        }
        assertThat(readSettings().path("version").asLong()).isEqualTo(current.path("version").asLong());
        assertThat(requests).isEmpty();
    }

    @Test void zeroWeightsAreOmittedWhileLiveWeightTypoAndPrefixChangesReachTheEngine() throws Exception {
        authenticate(Set.of("*.*"),false);
        var current=readSettings();
        var policy=(tools.jackson.databind.node.ObjectNode) mapper.valueToTree(SearchQueryPolicy.defaults());
        var fields=policy.path("fields").path("TASK");
        ((tools.jackson.databind.node.ObjectNode)fields.get(0)).put("weight",5).put("numTypos",1).put("prefix",false);
        ((tools.jackson.databind.node.ObjectNode)fields.get(1)).put("weight",0);
        mvc.perform(auth(put("/api/v1/search/settings")).content(saveJson(current.path("version").asLong(),policy)))
                .andExpect(status().isOk());
        mvc.perform(auth(get("/api/v1/search")).param("q","delivery").param("entity","TASK"))
                .andExpect(status().isOk());
        var emitted=mapper.readTree(requests.getLast()).path("searches").get(0);
        assertThat(emitted.path("query_by").asString()).isEqualTo("title,status_name,project_name");
        assertThat(emitted.path("query_by_weights").asString()).isEqualTo("5,2,2");
        assertThat(emitted.path("num_typos").asString()).isEqualTo("1,2,2");
        assertThat(emitted.path("prefix").asString()).isEqualTo("false,true,true");
    }

    @Test void rollbackNeverPublishesAnUncommittedPolicyOrAuditRow() {
        principal();
        try {
            var before=settings.current();
            new org.springframework.transaction.support.TransactionTemplate(transactions).executeWithoutResult(tx -> {
                settings.save(new com.greenwhite.dwh.instance.search.dto.SearchManagementDtos.SaveSettingsRequest(before.version(),withLimit(4)));
                assertThat(provider.current().globalLimit()).isEqualTo(10);
                tx.setRollbackOnly();
            });
            assertThat(settings.current()).isEqualTo(before);
            assertThat(provider.current().globalLimit()).isEqualTo(10);
            assertThat(auditCount()).isZero();
        } finally { com.greenwhite.dwh.instance.common.security.SecurityContext.clear(); }
    }

    @Test void databaseCommitFailureAfterTheSaveBodyDoesNotPublishThePolicy() {
        principal();
        var before=settings.current();
        jdbc.sql("create function fixture_reject_settings_commit() returns trigger language plpgsql as 'begin raise exception ''fixture commit rejected''; end'").update();
        jdbc.sql("create constraint trigger fixture_settings_commit after update on search_settings deferrable initially deferred for each row execute function fixture_reject_settings_commit()").update();
        try {
            org.assertj.core.api.Assertions.assertThatThrownBy(() -> settings.save(
                    new com.greenwhite.dwh.instance.search.dto.SearchManagementDtos.SaveSettingsRequest(before.version(),withLimit(4))))
                    .isInstanceOf(org.springframework.transaction.TransactionException.class);
            assertThat(settings.current()).isEqualTo(before);
            assertThat(provider.current().globalLimit()).isEqualTo(10);
            assertThat(auditCount()).isZero();
        } finally {
            jdbc.sql("drop trigger fixture_settings_commit on search_settings").update();
            jdbc.sql("drop function fixture_reject_settings_commit()").update();
            com.greenwhite.dwh.instance.common.security.SecurityContext.clear();
        }
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.MethodSource("invalidPolicies")
    void strictPolicyWhitelistRejectsMalformedOrUnusedConfiguration(String policy) throws Exception {
        authenticate(Set.of("*.*"),false);
        long version=readSettings().path("version").asLong();
        mvc.perform(auth(put("/api/v1/search/settings")).content("{\"version\":"+version+",\"policy\":"+policy+"}"))
                .andExpect(status().isBadRequest());
        assertThat(readSettings().path("version").asLong()).isEqualTo(version);
        assertThat(auditCount()).isZero();
        assertThat(paths).isEmpty();
    }

    static java.util.stream.Stream<String> invalidPolicies() {
        String policy=mapper.writeValueAsString(SearchQueryPolicy.defaults());
        var invalid=new ArrayList<String>();
        for (String replacement : List.of("\"requestsPerMinute\":29", "\"requestsPerMinute\":601"))
            invalid.add(policy.replace("\"requestsPerMinute\":120",replacement));
        for (String replacement : List.of("\"burst\":9", "\"burst\":61")) invalid.add(policy.replace("\"burst\":20",replacement));
        invalid.add(policy.replace("\"requestsPerMinute\":120","\"requestsPerMinute\":30").replace("\"burst\":20","\"burst\":31"));
        for (String replacement : List.of("\"schemaProfile\":null","\"schemaProfile\":\"ru\"","\"schemaProfile\":\"OTHER\""))
            invalid.add(policy.replace("\"schemaProfile\":\"MIXED\"",replacement));
        for (String replacement : List.of("\"weight\":-1","\"weight\":128","\"weight\":0.5","\"weight\":null","\"weight\":\"10\""))
            invalid.add(policy.replaceFirst("\"weight\":10",replacement));
        invalid.add(policy.replaceFirst("\"weight\":10,",""));
        for (String replacement : List.of("\"numTypos\":-1","\"numTypos\":3","\"numTypos\":1.5","\"numTypos\":null"))
            invalid.add(policy.replaceFirst("\"numTypos\":2",replacement));
        invalid.add(policy.replaceFirst("\"prefix\":true","\"prefix\":null"));
        invalid.add(policy.replaceFirst("\"prefix\":true","\"prefix\":\"true\""));
        invalid.add(policy.replaceFirst("\"prefix\":true","\"prefix\":true,\"unused\":true"));
        invalid.add(policy.replaceFirst("\"field\":\"title\"","\"field\":\"private_notes\""));
        invalid.add(policy.replaceFirst("\"field\":\"title\"","\"field\":\"status_name\""));
        invalid.add(policy.replaceFirst("\"TASK\":","\"OTHER\":"));
        invalid.add(policy.replaceFirst("\"globalLimit\":10,",""));
        invalid.add(policy.replaceFirst("\"globalLimit\":10","\"globalLimit\":10,\"arbitraryOption\":true"));
        invalid.add(policy.replaceAll("\"weight\":[0-9]+","\"weight\":0"));
        return invalid.stream();
    }

    @Test void strictSaveEnvelopeRejectsMissingNullFractionalAndDuplicateVersion() throws Exception {
        authenticate(Set.of("*.*"),false);
        String policy=mapper.writeValueAsString(SearchQueryPolicy.defaults());
        long before=readSettings().path("version").asLong();
        for (String body : List.of("null", "{}", "{\"version\":1}", "{\"policy\":"+policy+"}",
                "{\"version\":null,\"policy\":"+policy+"}", "{\"version\":1.5,\"policy\":"+policy+"}",
                "{\"version\":0,\"policy\":"+policy+"}", "{\"version\":1,\"version\":2,\"policy\":"+policy+"}",
                "{\"version\":1,\"policy\":null}", "{\"version\":1,\"policy\":"+policy+",\"url\":\"unused\"}"))
            mvc.perform(auth(put("/api/v1/search/settings")).content(body)).andExpect(status().isBadRequest());
        assertThat(readSettings().path("version").asLong()).isEqualTo(before);
        assertThat(paths).isEmpty();
    }

    @Test void savedRateAndBurstApplyToInteractivePreviewBeforeEngineWork() throws Exception {
        authenticate(Set.of("*.*"),false);
        long version=readSettings().path("version").asLong();
        var policy=new SearchQueryPolicy(10,30,10,"MIXED",SearchQueryPolicy.defaults().fields());
        mvc.perform(auth(put("/api/v1/search/settings")).content(saveJson(version,policy))).andExpect(status().isOk());
        for (int i=0;i<10;i++) mvc.perform(auth(post("/api/v1/search/preview")).content("{\"q\":\"delivery\",\"entity\":\"TASK\"}"))
                .andExpect(status().isOk());
        mvc.perform(auth(post("/api/v1/search/preview")).content("{\"q\":\"delivery\",\"entity\":\"TASK\"}"))
                .andExpect(status().isTooManyRequests());
        assertThat(paths).hasSize(10);
        mvc.perform(auth(get("/api/v1/search/settings"))).andExpect(status().isOk());
        assertThat(provider.effectiveBudgets().user().perMinute()).isEqualTo(30);
        assertThat(provider.effectiveBudgets().user().capacity()).isEqualTo(10);
    }

    @Test void corruptStoredSettingsStayExplicitAndFailedRefreshRetainsTheLastValidRate() throws Exception {
        authenticate(Set.of("*.*"),false);
        long version=readSettings().path("version").asLong();
        var policy=new SearchQueryPolicy(4,30,10,"MIXED",SearchQueryPolicy.defaults().fields());
        mvc.perform(auth(put("/api/v1/search/settings")).content(saveJson(version,policy))).andExpect(status().isOk());
        jdbc.sql("update search_settings set configuration='{\"globalLimit\":50}' where id=1").update();
        provider.refresh();
        assertThat(provider.degraded()).isTrue();
        assertThat(provider.current().globalLimit()).isEqualTo(4);
        assertThat(provider.effectiveBudgets().user().perMinute()).isEqualTo(30);
        mvc.perform(auth(get("/api/v1/search/settings"))).andExpect(status().isServiceUnavailable());
        mvc.perform(auth(get("/api/v1/search")).param("q","delivery")).andExpect(status().isServiceUnavailable());
        assertThat(paths).isEmpty();
        mvc.perform(auth(get("/api/v1/search/status"))).andExpect(status().isOk()).andExpect(jsonPath("$.settingsDegraded").value(true));
    }

    @Test void delayedEarlierCommitCannotReplaceTheNewerCommittedPolicy() throws Exception {
        principal();
        long version=settings.current().version();
        com.greenwhite.dwh.instance.common.security.SecurityContext.clear();
        var committed=new java.util.concurrent.CountDownLatch(1);
        var release=new java.util.concurrent.CountDownLatch(1);
        try (var executor=java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var first=executor.submit(() -> {
                principal();
                try {
                    new org.springframework.transaction.support.TransactionTemplate(transactions).executeWithoutResult(tx -> {
                        org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                                new org.springframework.transaction.support.TransactionSynchronization() {
                            public void afterCommit() { committed.countDown(); await(release); }
                        });
                        settings.save(new com.greenwhite.dwh.instance.search.dto.SearchManagementDtos.SaveSettingsRequest(version,withLimit(4)));
                    });
                } finally { com.greenwhite.dwh.instance.common.security.SecurityContext.clear(); }
            });
            try {
                assertThat(committed.await(10,java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                principal();
                var saved=settings.save(new com.greenwhite.dwh.instance.search.dto.SearchManagementDtos.SaveSettingsRequest(version+1,withLimit(5)));
                assertThat(saved.version()).isEqualTo(version+2);
                assertThat(provider.current().globalLimit()).isEqualTo(5);
            } finally { release.countDown(); com.greenwhite.dwh.instance.common.security.SecurityContext.clear(); }
            first.get(10,java.util.concurrent.TimeUnit.SECONDS);
            assertThat(provider.current().globalLimit()).isEqualTo(5);
            assertThat(provider.snapshot().version()).isEqualTo(version+2);
        }
    }

    @Test void executionUsesOneCommittedGenerationAndPolicySnapshotAndReleasesItsConnectionBeforeHttp() throws Exception {
        authenticate(Set.of("*.*"),false);
        long version=readSettings().path("version").asLong();
        mvc.perform(auth(put("/api/v1/search/settings")).content(saveJson(version,withLimit(14)))).andExpect(status().isOk());
        var source=(ObservingDataSource)contextSource;
        Thread caller=Thread.currentThread();
        var networkConnections=new java.util.concurrent.atomic.AtomicInteger(-1);
        beforeEngine=() -> networkConnections.set(source.openConnections(caller));
        source.observe(caller, () -> new org.springframework.transaction.support.TransactionTemplate(transactions).executeWithoutResult(tx -> {
            jdbc.sql("update search_settings set version=version+1,configuration=cast(:policy as jsonb) where id=1")
                    .param("policy",mapper.writeValueAsString(withLimit(5))).update();
            jdbc.sql("update search_generations set task_collection='next_tasks'").update();
        }));
        try {
            mvc.perform(auth(get("/api/v1/search")).param("q","delivery").param("entity","TASK"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.totalHits").value(14));
            var emitted=mapper.readTree(requests.getLast()).path("searches").get(0);
            assertThat(emitted.path("collection").asString()).isEqualTo("fixture_tasks");
            assertThat(emitted.path("per_page").asInt()).isEqualTo(14);
            assertThat(source.snapshotReads.get()).isEqualTo(1);
            assertThat(networkConnections).hasValue(0);
        } finally { source.stopObserving(); beforeEngine=() -> {}; }
        mvc.perform(auth(get("/api/v1/search")).param("q","delivery").param("entity","TASK"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalHits").value(5));
        assertThat(mapper.readTree(requests.getLast()).path("searches").get(0).path("collection").asString()).isEqualTo("next_tasks");
    }

    @Test void genericPerUserSettingsCannotOverrideTheInstanceSearchPolicy() throws Exception {
        authenticate(Set.of("*.*"),false);
        long user=jdbc.sql("insert into md_users(name,login,email,password_hash,state,language,timezone) values('Search fixture',:login,:email,'x','A','ru','UTC') returning id")
                .param("login","search-fixture-"+actorId).param("email","search-fixture-"+actorId+"@example.invalid").query(Long.class).single();
        jdbc.sql("insert into md_settings(user_id,key,value) values(:user,'search',:policy),(:user,'platform.search',:policy),(:user,'search.globalLimit','50')")
                .param("user",user).param("policy",mapper.writeValueAsString(withLimit(50))).update();
        actorId=user;
        authenticate(Set.of("*.*"),false);
        mvc.perform(auth(get("/api/v1/search")).param("q","delivery").param("entity","TASK"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.totalHits").value(10));
        assertThat(readSettings().path("policy").path("globalLimit").asInt()).isEqualTo(10);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings={"", "0", "51", "1.5", "null"})
    void invalidExplicitLimitsNeverBecomeTheSavedDefault(String value) throws Exception {
        authenticate(Set.of("*.*"),false);
        mvc.perform(auth(get("/api/v1/search")).param("q","delivery").param("limit",value)).andExpect(status().isBadRequest());
        assertThat(paths).isEmpty();
    }

    private static void await(java.util.concurrent.CountDownLatch latch) {
        try { if (!latch.await(10,java.util.concurrent.TimeUnit.SECONDS)) throw new AssertionError("fixture latch timeout"); }
        catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new AssertionError(interrupted); }
    }

    private void principal() {
        com.greenwhite.dwh.instance.common.security.SecurityContext.setPrincipal(new com.greenwhite.dwh.instance.common.security.SecurityContext.KauthPrincipal(
                actorId,"fixture","fixture@example.invalid",actorId,false,Set.of("*.*"),1,false,0,null));
    }
    private long auditCount() { return jdbc.sql("select count(*) from audit_log where table_name='search_settings' and changed_by=:actor")
            .param("actor",actorId).query(Long.class).single(); }
    private static SearchQueryPolicy withLimit(int limit) { return new SearchQueryPolicy(limit,120,20,"MIXED",SearchQueryPolicy.defaults().fields()); }
}

@org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc(print=org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint.NONE)
@WebMvcTest(controllers = SearchController.class, properties = {
        "logging.level.org.springframework.boot.security.autoconfigure=ERROR",
        "dwh.typesense.enabled=false", "dwh.typesense.url=http://127.0.0.1:1",
        "dwh.rate-limit.expensive-per-minute=600",
        "spring.datasource.url=jdbc:postgresql://127.0.0.1:1/unused", "server.port=0", "management.server.port=0"})
@Import({SearchSettingsIntegrationTestSupport.Fixture.class, SecurityConfig.class, ProblemDetailAuthHandlers.class,
        KauthAuthenticationFilter.class, RateLimitFilter.class, RateLimitService.class,
        com.greenwhite.dwh.instance.config.idempotency.IdempotencyFilter.class})
abstract class SearchSettingsIntegrationTestSupport {
    static final ObjectMapper mapper = new ObjectMapper();
    static final List<String> requests = new CopyOnWriteArrayList<>();
    static final List<String> paths = new CopyOnWriteArrayList<>();
    static final Map<String,String> responses = new java.util.concurrent.ConcurrentHashMap<>();
    static final Map<String,Integer> responseStatuses = new java.util.concurrent.ConcurrentHashMap<>();
    static volatile int healthStatus = 200;
    static volatile Runnable beforeEngine=() -> {};
    static final java.util.concurrent.atomic.AtomicLong actorSequence = new java.util.concurrent.atomic.AtomicLong(1000);
    long actorId;
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("search_management_test").withUsername("fixture").withPassword("fixture-only");
    static final HttpServer engine;
    static {
        try {
            engine = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            engine.createContext("/", exchange -> {
                String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                requests.add(body);
                paths.add(exchange.getRequestMethod()+" "+exchange.getRequestURI().getPath());
                beforeEngine.run();
                String output;
                if (exchange.getRequestURI().getPath().equals("/multi_search")) {
                    var searches = mapper.readTree(body).path("searches");
                    var results = new ArrayList<Map<String,Object>>();
                    for (var search : searches) {
                        var hits = new ArrayList<Map<String,Object>>();
                        for (int i=1;i<=search.path("per_page").asInt();i++)
                            hits.add(Map.of("document", Map.of("id", ""+i, "title", "Delivery "+i, "task_id", i)));
                        results.add(Map.of("hits", hits, "found", 30, "search_time_ms", 1));
                    }
                    output = mapper.writeValueAsString(Map.of("results", results));
                } else output = responses.getOrDefault(exchange.getRequestURI().getPath(), "{\"ok\":true}");
                byte[] bytes = output.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(responseStatuses.getOrDefault(exchange.getRequestURI().getPath(),
                        exchange.getRequestURI().getPath().equals("/health") ? healthStatus : 200), bytes.length);
                exchange.getResponseBody().write(bytes); exchange.close();
            });
            engine.start(); postgres.start();
        } catch (Exception failure) { throw new ExceptionInInitializerError(failure); }
    }
    @Autowired MockMvc mvc;
    @Autowired JdbcClient jdbc;
    @Autowired SearchPolicyProvider provider;
    @Autowired DataSource contextSource;
    @MockitoBean KauthSessionService sessions;
    @MockitoBean KauthApiTokenService apiTokens;
    @MockitoBean MdUserService users;
    @MockitoBean MdPermissionService permissions;
    @MockitoBean RoleMembershipAuthorizer roles;
    @MockitoBean com.greenwhite.dwh.instance.common.metrics.PlatformMetrics metrics;
    @MockitoBean com.greenwhite.dwh.instance.config.idempotency.IdempotencyService idempotency;

    @BeforeEach void resetData() {
        actorId=actorSequence.incrementAndGet();
        requests.clear();
        paths.clear(); responses.clear(); responseStatuses.clear(); healthStatus=200;
        beforeEngine=() -> {};
        responses.put("/debug", "{\"version\":\"27.1\",\"state\":1}");
        responses.put("/metrics.json", "{\"system_disk_used_bytes\":\"123456\",\"system_disk_total_bytes\":\"999999\"}");
        for (var type : List.of("TASK","PROJECT","USER")) {
            String collection = "fixture_"+switch (type) { case "TASK" -> "tasks"; case "PROJECT" -> "projects"; default -> "users"; };
            var schema = new LinkedHashMap<>(SearchCollectionSchema.mixed(collection, type));
            schema.put("num_documents", 23);
            responses.put("/collections/"+collection,mapper.writeValueAsString(schema));
        }
        jdbc.sql("update search_settings set configuration=cast(:policy as jsonb),version=version+1 where id=1")
                .param("policy",mapper.writeValueAsString(SearchQueryPolicy.defaults())).update();
        jdbc.sql("update search_index_state set active_generation_id=null, initialized=false where id=1").update();
        jdbc.sql("delete from search_jobs").update();
        jdbc.sql("delete from search_generation_delivery").update();
        jdbc.sql("delete from search_projection_versions").update();
        jdbc.sql("delete from search_generations").update();
        var id = UUID.randomUUID();
        jdbc.sql("insert into search_generations(id,state,task_collection,project_collection,user_collection,schema_version,schema_profile,settings_version) values(:id,'ACTIVE','fixture_tasks','fixture_projects','fixture_users',1,'MIXED',1)")
                .param("id", id).update();
        jdbc.sql("update search_index_state set active_generation_id=:id,initialized=true where id=1").param("id",id).update();
        provider.refresh();
    }
    void authenticate(Set<String> allowed, boolean admin) {
        when(sessions.getActiveSession(anyString())).thenReturn(Optional.of(new KauthSessionRepository.SessionRecord(
                actorId, actorId,"fixture","127.0.0.1","fixture",null,Instant.now(),Instant.now(),null,0)));
        var fixtureUser = new MdUserRepository.UserRecord(actorId,"Fixture","fixture","fixture@example.invalid",null,"x",
                "A",null,"ru","UTC",null,Map.of(),false,false,null,Instant.now(),Instant.now(),null,null,0);
        when(users.getUserById(actorId)).thenReturn(fixtureUser);
        when(users.findAuthUserById(actorId)).thenReturn(Optional.of(MdUserService.AuthUser.from(fixtureUser)));
        when(permissions.getEffectivePermissions(actorId)).thenReturn(allowed);
        when(permissions.getPermissionVersion(actorId)).thenReturn(1L);
        when(roles.hasActiveRole(anyLong(), anyString())).thenReturn(admin);
    }
    static MockHttpServletRequestBuilder auth(MockHttpServletRequestBuilder request) {
        return request.cookie(new Cookie("DWH_SESSION", "fixture-session"), new Cookie("XSRF-TOKEN", "fixture-csrf"))
                .header("X-XSRF-TOKEN", "fixture-csrf").contentType("application/json");
    }
    tools.jackson.databind.JsonNode readSettings() throws Exception {
        return mapper.readTree(mvc.perform(auth(get("/api/v1/search/settings"))).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
    }
    static String saveJson(long version, Object policy) { return mapper.writeValueAsString(Map.of("version",version,"policy",policy)); }

    @Configuration(proxyBeanMethods=false)
    @EnableTransactionManagement
    @ComponentScan(basePackages="com.greenwhite.dwh.instance.search", useDefaultFilters=false,
            includeFilters=@ComponentScan.Filter(type=FilterType.REGEX, pattern=".*(SearchGenerationService|SearchGenerationRepository|SearchStoragePreflight|SearchProjectionReader|SearchJobService|SearchJobRepository|SearchController|SearchManagementController|SearchSettingsService|SearchStatusService|SearchExecutionSnapshotReader|SearchSettingsRepository|SearchPolicyProvider|SearchService|SearchAccessPolicy|SearchResultBudget|SearchIndexStateRepository|SearchFallbackRepository|TypesenseClient)$"))
    @Import({AuditLogService.class, AuditLogRepository.class, AuditDataRedactor.class, LegacyController.class})
    static class Fixture {
        @Bean DataSource dataSource() {
            var dataSource = new DriverManagerDataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
            com.greenwhite.dwh.instance.config.db.FlywayUtcConfiguration.configure(org.flywaydb.core.Flyway.configure())
                    .dataSource(dataSource).locations("classpath:db/migration").load().migrate();
            return new ObservingDataSource(dataSource);
        }
        @Bean JdbcClient jdbcClient(DataSource source) { return JdbcClient.create(source); }
        @Bean DataSourceTransactionManager transactionManager(DataSource source) { return new DataSourceTransactionManager(source); }
        @Bean TypesenseProperties typesenseProperties() { return new TypesenseProperties("http://127.0.0.1:"+engine.getAddress().getPort(),"fixture-key",true,false); }
        @Bean(destroyMethod="close") AutoCloseable ownedResources() { return () -> { engine.stop(0); postgres.stop(); }; }
    }

    @org.springframework.web.bind.annotation.RestController
    static class LegacyController {
        @org.springframework.web.bind.annotation.PostMapping("/api/v1/search-test/legacy")
        public LegacyOptional legacy(@org.springframework.web.bind.annotation.RequestBody LegacyOptional request) { return request; }
    }
    record LegacyOptional(int optional) {}

    static final class ObservingDataSource extends AbstractDataSource {
        private final DataSource delegate;
        private final Map<Thread,java.util.concurrent.atomic.AtomicInteger> open=new java.util.concurrent.ConcurrentHashMap<>();
        private final java.util.concurrent.atomic.AtomicReference<Runnable> afterRead=new java.util.concurrent.atomic.AtomicReference<>();
        final java.util.concurrent.atomic.AtomicInteger snapshotReads=new java.util.concurrent.atomic.AtomicInteger();
        private volatile Thread observedThread;
        ObservingDataSource(DataSource delegate) { this.delegate=delegate; }
        void observe(Thread thread,Runnable callback) { snapshotReads.set(0); afterRead.set(callback); observedThread=thread; }
        void stopObserving() { observedThread=null; afterRead.set(null); }
        int openConnections(Thread thread) { return open.getOrDefault(thread,new java.util.concurrent.atomic.AtomicInteger()).get(); }
        public java.sql.Connection getConnection() throws java.sql.SQLException { return track(delegate.getConnection()); }
        public java.sql.Connection getConnection(String user,String password) throws java.sql.SQLException { return track(delegate.getConnection(user,password)); }
        private java.sql.Connection track(java.sql.Connection connection) {
            Thread owner=Thread.currentThread();
            var count=open.computeIfAbsent(owner,ignored -> new java.util.concurrent.atomic.AtomicInteger()); count.incrementAndGet();
            var closed=new java.util.concurrent.atomic.AtomicBoolean();
            return (java.sql.Connection)java.lang.reflect.Proxy.newProxyInstance(java.sql.Connection.class.getClassLoader(),new Class<?>[]{java.sql.Connection.class},
                    (proxy,method,args) -> {
                        if (method.getName().equals("close") && closed.compareAndSet(false,true)) count.decrementAndGet();
                        Object result=invoke(connection,method,args);
                        if (method.getName().equals("prepareStatement") && result instanceof java.sql.PreparedStatement statement
                                && args[0] instanceof String sql && (sql.contains("search_index_state") || sql.contains("search_settings")))
                            return java.lang.reflect.Proxy.newProxyInstance(java.sql.PreparedStatement.class.getClassLoader(),new Class<?>[]{java.sql.PreparedStatement.class},
                                    (statementProxy,statementMethod,statementArgs) -> {
                                        Object statementResult=invoke(statement,statementMethod,statementArgs);
                                        if (Thread.currentThread()==observedThread && statementMethod.getName().equals("executeQuery")) {
                                            snapshotReads.incrementAndGet();
                                            Runnable callback=afterRead.getAndSet(null); if (callback!=null) callback.run();
                                        }
                                        return statementResult;
                                    });
                        return result;
                    });
        }
        private static Object invoke(Object target,java.lang.reflect.Method method,Object[] args) throws Throwable {
            try { return method.invoke(target,args); }
            catch (java.lang.reflect.InvocationTargetException failure) { throw failure.getCause(); }
        }
    }
}

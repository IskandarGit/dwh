package com.greenwhite.dwh.instance.search;

import com.greenwhite.dwh.instance.audit.service.AuditLogService;
import com.greenwhite.dwh.instance.common.security.ScopeFilter;
import com.greenwhite.dwh.instance.config.db.FlywayUtcConfiguration;
import com.greenwhite.dwh.instance.md.repository.MdRoleRepository;
import com.greenwhite.dwh.instance.md.repository.MdUserRepository;
import com.greenwhite.dwh.instance.md.service.*;
import com.greenwhite.dwh.instance.kauth.repository.KauthSessionRepository;
import com.greenwhite.dwh.instance.kauth.repository.KauthApiTokenRepository;
import com.greenwhite.dwh.instance.kauth.service.KauthUserSessionInvalidator;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.ms.task.repository.*;
import com.greenwhite.dwh.instance.ms.task.service.MsTaskService;
import com.greenwhite.dwh.instance.search.repository.*;
import com.greenwhite.dwh.instance.search.service.SearchDeliveryWorker;
import com.greenwhite.dwh.instance.search.service.*;
import com.greenwhite.dwh.instance.search.typesense.*;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@Testcontainers
abstract class SearchDeliveryTestSupport {
    @Container static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:18-alpine")
            .withDatabaseName("search_delivery").withUsername("test_user").withPassword("test_pass");
    static JdbcClient jdbc;
    static DriverManagerDataSource database;
    static DataSourceTransactionManager manager;
    static TransactionTemplate tx;
    final ObjectMapper mapper = new ObjectMapper();
    final MutableClock clock = new MutableClock();
    final io.micrometer.core.instrument.simple.SimpleMeterRegistry metricRegistry=new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
    final SearchMetrics metrics=new SearchMetrics(metricRegistry);
    final Map<String,Map<String,Object>> documents = new ConcurrentHashMap<>();
    final Set<String> collections = ConcurrentHashMap.newKeySet();
    final List<Map<String,Object>> schemas = new CopyOnWriteArrayList<>();
    final List<String> writes = new CopyOnWriteArrayList<>();
    final List<List<String>> searchCollections = new CopyOnWriteArrayList<>();
    final AtomicInteger failures = new AtomicInteger();
    final AtomicInteger requests = new AtomicInteger();
    final Set<String> rejectedImportIds=ConcurrentHashMap.newKeySet();
    volatile String diskMetrics="{\"system_disk_total_bytes\":\"1073741824\",\"system_disk_used_bytes\":\"1024\"}";
    volatile Consumer<HttpExchange> beforeWrite = exchange -> {};
    volatile Consumer<HttpExchange> beforeRequest = exchange -> {};
    HttpServer http;
    ExecutorService httpThreads;
    TypesenseClient client;
    SearchChangePublisher publisher;
    SearchProjectionReader reader;
    SearchDeliveryRepository delivery;
    SearchIndexStateRepository state;
    SearchDeliveryWorker worker;
    SearchJobWorker jobWorker;
    SearchJobService jobService;
    SearchJobRepository jobRepository;
    SearchGenerationRepository generationRepository;
    SearchGenerationService generationService;
    SearchReconciliationService reconciliation;
    SearchStoragePreflight storage;
    MsTaskService tasks;
    MdUserService users;
    UUID owner;

    @BeforeAll static void migrate() {
        database = new DriverManagerDataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
        FlywayUtcConfiguration.configure(Flyway.configure()).dataSource(database).load().migrate();
        jdbc = JdbcClient.create(database);
        manager = new DataSourceTransactionManager(database);
        tx = new TransactionTemplate(manager);
    }

    @BeforeEach void setupDelivery() throws IOException {
        for (String sql : List.of("delete from search_generation_delivery", "delete from search_jobs",
                "update search_index_state set active_generation_id=null,initialized=false,version=1,worker_owner=null",
                "delete from search_generations", "delete from search_projection_versions",
                "truncate ms_tasks,ms_task_projects,md_users cascade")) jdbc.sql(sql).update();
        publisher = SearchRevisionIntegrationTest.proxied(new SearchChangePublisher(jdbc), manager);
        reader = new SearchProjectionReader(jdbc, mapper);
        delivery = SearchRevisionIntegrationTest.proxied(new SearchDeliveryRepository(jdbc), manager);
        state = SearchRevisionIntegrationTest.proxied(new SearchIndexStateRepository(jdbc), manager);
        var scopes = mock(MdScopeService.class);
        when(scopes.filterForTasks(any())).thenReturn(ScopeFilter.unrestricted());
        var audit = mock(AuditLogService.class);
        tasks = SearchRevisionIntegrationTest.proxied(new MsTaskService(new MsTaskRepository(jdbc, mapper),
                new MsTaskStatusRepository(jdbc), new MsTaskTypeRepository(jdbc), new MsTaskMemberRepository(jdbc),
                new MsProjectRepository(jdbc, mapper), mock(MdCustomFieldService.class), scopes,
                mock(MfFileService.class), mock(ApplicationEventPublisher.class), publisher, audit), manager);
        users = SearchRevisionIntegrationTest.proxied(new MdUserService(new MdUserRepository(jdbc, mapper),
                new MdRoleRepository(jdbc), mock(MdCustomFieldService.class), mock(PasswordHasher.class),
                mock(PasswordValidator.class), new KauthUserSessionInvalidator(new KauthSessionRepository(jdbc),
                new KauthApiTokenRepository(jdbc)), publisher, audit, scopes), manager);
        http = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        httpThreads = Executors.newCachedThreadPool();
        http.setExecutor(httpThreads);
        http.createContext("/", this::respond);
        http.start();
        client = new TypesenseClient(new TypesenseProperties("http://127.0.0.1:" + http.getAddress().getPort(),
                "test-key", true, false), mapper,Optional.of(metrics));
        recreateWorker();
    }

    @AfterEach void stopHttp() {
        if (jobWorker!=null) jobWorker.close();
        http.stop(0);
        httpThreads.shutdownNow();
        metricRegistry.close();
    }

    void recreateWorker() {
        if (jobWorker!=null) jobWorker.close();
        owner = UUID.randomUUID();
        worker = new SearchDeliveryWorker(client, reader, delivery, state, clock, () -> 0.5,metrics);
        worker.startLifecycle(owner);
        jobRepository=SearchRevisionIntegrationTest.proxied(new SearchJobRepository(jdbc,mapper),manager);
        generationRepository=new SearchGenerationRepository(jdbc);
        generationService=new SearchGenerationService(generationRepository,new SearchSettingsRepository(jdbc),4);
        storage=new SearchStoragePreflight(client,reader);
        reconciliation=new SearchReconciliationService(database,reader,client);
        jobService=SearchRevisionIntegrationTest.proxied(new SearchJobService(
                new SearchAccessPolicy(mock(com.greenwhite.dwh.instance.common.security.RoleMembershipAuthorizer.class)),
                jobRepository,state,generationService,storage,manager,Optional.of(metrics)),manager);
        jobWorker=new SearchJobWorker(client,worker,state,jobRepository,generationRepository,generationService,jobService,reconciliation,storage,Optional.of(metrics));
        jobWorker.startLifecycle(owner);
    }

    void runCycle() { worker.runOnce();jobWorker.runOnce(); }

    UUID activeGeneration() {
        collections.addAll(List.of("tasks", "projects", "users"));
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                insert into search_generations(id,state,task_collection,project_collection,user_collection,
                    schema_version,schema_profile,settings_version,discovery_entity)
                values (:id,'ACTIVE','tasks','projects','users',1,'MIXED',1,'DONE')
                """).param("id", id).update();
        jdbc.sql("update search_index_state set active_generation_id=:id,initialized=true where id=1")
                .param("id", id).update();
        return id;
    }

    long user(String name) {
        return users.createUser(name, "user-" + UUID.randomUUID(), UUID.randomUUID() + "@example.invalid", null,
                null, null, "ru", "UTC", null, null, false, false, null, null).id();
    }

    long task(long reporter, String title) {
        return tasks.createTask(null, null, title, "body", "medium", null, null, null, null, null, reporter).id();
    }

    long delivered(String type, long id) {
        return jdbc.sql("select coalesce(max(delivered_revision),0) from search_generation_delivery where entity_type=:type and entity_id=:id")
                .param("type", type).param("id", id).query(Long.class).single();
    }

    @SuppressWarnings("unchecked")
    private void respond(HttpExchange exchange) throws IOException {
        requests.incrementAndGet();
        beforeRequest.accept(exchange);
        String method = exchange.getRequestMethod();
        String path = exchange.getRequestURI().getPath();
        if (failures.getAndUpdate(n -> Math.max(0, n - 1)) > 0) { respond(exchange, 503, "unavailable"); return; }
        if (path.equals("/health")) { respond(exchange,200,"{\"ok\":true}"); return; }
        if (path.equals("/debug")) { respond(exchange,200,"{\"version\":\"27.1\"}"); return; }
        if (path.equals("/metrics.json")) { respond(exchange,200,diskMetrics); return; }
        if (path.equals("/multi_search")) {
            var searches = mapper.readTree(exchange.getRequestBody()).path("searches");
            List<String> names = new ArrayList<>();
            searches.forEach(search -> names.add(search.path("collection").asText()));
            searchCollections.add(names);
            respond(exchange, 200, mapper.writeValueAsString(Map.of("results", names.stream()
                    .map(name -> Map.of("found", 0, "search_time_ms", 0, "hits", List.of())).toList())));
            return;
        }
        if (path.equals("/collections") && method.equals("POST")) {
            Map<String,Object> schema = mapper.readValue(exchange.getRequestBody(), Map.class);
            collections.add((String) schema.get("name")); schemas.add(schema);
            respond(exchange, 201, "{}"); return;
        }
        String[] parts = path.split("/");
        if (parts.length < 3 || !collections.contains(parts[2])) { respond(exchange, 404, "missing"); return; }
        if (parts.length == 3) {
            String type=parts[2].endsWith("tasks") ? "TASK" : parts[2].endsWith("projects") ? "PROJECT" : "USER";
            var schema=new LinkedHashMap<String,Object>(schemas.stream().filter(value -> parts[2].equals(value.get("name"))).findFirst()
                    .orElseGet(() -> SearchCollectionSchema.mixed(parts[2],type)));
            schema.put("num_documents",documents.keySet().stream().filter(key -> key.startsWith(parts[2]+"/")).count());
            respond(exchange,200,mapper.writeValueAsString(schema)); return;
        }
        if (path.endsWith("/documents/export") && method.equals("GET")) {
            StringBuilder output=new StringBuilder();
            documents.entrySet().stream().filter(entry -> entry.getKey().startsWith(parts[2]+"/"))
                    .sorted(Map.Entry.comparingByKey()).forEach(entry -> output.append(mapper.writeValueAsString(entry.getValue())).append('\n'));
            respond(exchange,200,output.toString()); return;
        }
        beforeWrite.accept(exchange);
        writes.add(method + " " + path);
        if (method.equals("POST") && path.endsWith("/documents/import")) {
            String input=new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8);
            StringBuilder output=new StringBuilder();
            for (String line : input.lines().toList()) {
                Map<String,Object> document=mapper.readValue(line,Map.class);
                boolean accepted=!rejectedImportIds.contains(document.get("id").toString());
                if (accepted) documents.put(parts[2]+"/"+document.get("id"),document);
                output.append(accepted ? "{\"success\":true}\n" : "{\"success\":false,\"error\":\"private fixture rejection\"}\n");
            }
            respond(exchange,200,output.toString());
        } else if (method.equals("POST")) {
            Map<String,Object> document = mapper.readValue(exchange.getRequestBody(), Map.class);
            documents.put(parts[2] + "/" + document.get("id"), document);
            respond(exchange, 201, "{}");
        } else if (method.equals("DELETE")) {
            boolean present = documents.remove(parts[2] + "/" + parts[4]) != null;
            respond(exchange, present ? 200 : 404, "{}");
        } else { respond(exchange, 400, "invalid"); }
    }

    private void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
        exchange.close();
    }

    static class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-09-07T00:00:00Z");
        void advance(Duration duration) { now = now.plus(duration); }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}

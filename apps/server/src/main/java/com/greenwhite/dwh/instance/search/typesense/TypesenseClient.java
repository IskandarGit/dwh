package com.greenwhite.dwh.instance.search.typesense;

import tools.jackson.databind.ObjectMapper;

import com.greenwhite.dwh.instance.search.service.SearchService.SearchHit;
import com.greenwhite.dwh.instance.search.service.FieldPolicy;
import com.greenwhite.dwh.instance.search.service.SearchQueryPolicy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.HttpClientErrorException;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

@Component
public class TypesenseClient {

    private static final Logger log = LoggerFactory.getLogger(TypesenseClient.class);
    private static final int CONNECT_TIMEOUT_MS = 1500;
    private static final int READ_TIMEOUT_MS = 3000;

    public static final String COL_TASKS = "tasks";
    public static final String COL_PROJECTS = "projects";
    public static final String COL_USERS = "users";

    private final TypesenseProperties properties;
    private final RestClient restClient;
    private final TypesenseSearchMapper searchMapper;
    private final ObjectMapper objectMapper;
    private com.greenwhite.dwh.instance.search.service.SearchMetrics metrics=com.greenwhite.dwh.instance.search.service.SearchMetrics.unmetered();

    @org.springframework.beans.factory.annotation.Autowired
    public TypesenseClient(TypesenseProperties properties,ObjectMapper mapper,java.util.Optional<com.greenwhite.dwh.instance.search.service.SearchMetrics> metrics) {
        this(properties,mapper);this.metrics=metrics.orElseGet(com.greenwhite.dwh.instance.search.service.SearchMetrics::unmetered);
    }

    public TypesenseClient(TypesenseProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.searchMapper = new TypesenseSearchMapper(objectMapper);

        var requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(Duration.ofMillis(CONNECT_TIMEOUT_MS));
        requestFactory.setReadTimeout(Duration.ofMillis(READ_TIMEOUT_MS));

        this.restClient = RestClient.builder()
                .baseUrl(properties.url())
                .defaultHeader("X-TYPESENSE-API-KEY", properties.apiKey())
                .defaultHeader("Content-Type", MediaType.APPLICATION_JSON_VALUE)
                .requestFactory(requestFactory)
                .build();
    }

    public boolean isEnabled() {
        return properties.enabled();
    }

    public boolean isHealthy() {
        if (!properties.enabled()) return false;
        try {
            var response = metadata("/health");
            return response.path("ok").isBoolean() && response.path("ok").asBoolean();
        } catch (Exception e) {
            log.debug("Typesense health check unavailable");
            return false;
        }
    }

    public DependencyMetadata observeDependency() {
        if (!isEnabled()) return new DependencyMetadata(false, false, null, null, null, "DISABLED");
        if (!isHealthy()) return new DependencyMetadata(true, false, null, null, null, "DEPENDENCY_UNAVAILABLE");
        String version = null;
        Long used = null;
        Long total = null;
        String error = null;
        try {
            var value = metadata("/debug").path("version");
            if (value.isString() && value.asString().length() <= 48
                    && value.asString().matches("[0-9]+\\.[0-9]+(?:\\.[0-9]+)?(?:[-+][A-Za-z0-9.-]+)?")) version = value.asString();
            else error = "METADATA_UNAVAILABLE";
        } catch (RuntimeException unavailable) { error = "METADATA_UNAVAILABLE"; }
        try {
            var metrics = metadata("/metrics.json");
            used = nonnegativeInteger(metrics.path("system_disk_used_bytes"), true);
            total = nonnegativeInteger(metrics.path("system_disk_total_bytes"), true);
            if (used == null || total == null) error = "METADATA_UNAVAILABLE";
        } catch (RuntimeException unavailable) { error = "METADATA_UNAVAILABLE"; }
        return new DependencyMetadata(true, true, version, used, total, error);
    }

    public CollectionMetadata observeCollection(String collection, String entityType, String registeredProfile) {
        if (!isEnabled()) return new CollectionMetadata(null, null, null, "DEPENDENCY_UNAVAILABLE");
        try {
            var schema = metadata("/collections/{collection}", collection);
            Long count = nonnegativeInteger(schema.path("num_documents"), false);
            Boolean matches = matchesSchema(schema, collection, entityType, registeredProfile);
            return new CollectionMetadata(count, null, matches,
                    count == null ? "COLLECTION_METADATA_UNAVAILABLE" : null);
        } catch (HttpClientErrorException.NotFound missing) {
            return new CollectionMetadata(null, null, false, "COLLECTION_MISSING");
        } catch (RuntimeException unavailable) {
            return new CollectionMetadata(null, null, null, "COLLECTION_METADATA_UNAVAILABLE");
        }
    }

    public TransportBudgets transportBudgets() { return new TransportBudgets(CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS); }

    public record ImportAck(String id, boolean success, String errorCode) {}

    public TypesenseDocumentStream openDocumentMetadata(String collection) {
        if (!isEnabled()) throw TypesenseException.uninitialized();
        try {
            return restClient.get().uri("/collections/{collection}/documents/export", collection)
                    .exchange((request, response) -> {
                        if (!response.getStatusCode().is2xxSuccessful()) {
                            response.getBody().close(); response.close();
                            throw TypesenseException.unavailable();
                        }
                        try { return new TypesenseDocumentStream(response, objectMapper); }
                        catch (Exception failure) { response.close();throw failure; }
                    }, false);
        } catch (Exception failure) { throw TypesenseException.unavailable(); }
    }
    public void forEachDocumentMetadata(String collection,
            java.util.function.Consumer<TypesenseDocumentStream.DocumentMetadata> consumer) {
        try (var stream = openDocumentMetadata(collection)) {
            while (!stream.exhausted()) stream.readPage(100, 1_048_576).forEach(consumer);
        }
    }

    public List<ImportAck> importDocuments(String collection, List<Map<String,Object>> documents) {
        if (!isEnabled()) throw TypesenseException.uninitialized();
        var result = new java.util.ArrayList<ImportAck>();
        var batch = new java.io.ByteArrayOutputStream();
        var ids = new java.util.ArrayList<String>();
        for (var document : documents) {
            if (Thread.currentThread().isInterrupted()) throw TypesenseException.unavailable();
            Object rawId = document.get("id");
            if (!(rawId instanceof String id) || id.isBlank()) throw TypesenseException.invalidResponse();
            var encoded = new LimitedOutput(1_048_575);
            try { objectMapper.writeValue(encoded, document); }
            catch (RuntimeException failure) {
                if (!encoded.exceeded) throw TypesenseException.invalidResponse();
            }
            if (encoded.exceeded) {
                if (!ids.isEmpty()) { result.addAll(sendImport(collection, batch.toByteArray(), ids)); batch.reset(); ids.clear(); }
                result.add(new ImportAck(id, false, "DOCUMENT_TOO_LARGE"));
                metrics.imported(false,1);
                continue;
            }
            byte[] line = encoded.bytes.toByteArray();
            if (ids.size() == 100 || batch.size() + line.length + 1 > 1_048_576) {
                result.addAll(sendImport(collection, batch.toByteArray(), ids)); batch.reset(); ids.clear();
            }
            batch.writeBytes(line); batch.write('\n'); ids.add(id);
        }
        if (!ids.isEmpty()) result.addAll(sendImport(collection, batch.toByteArray(), ids));
        return List.copyOf(result);
    }

    private List<ImportAck> sendImport(String collection, byte[] body, List<String> ids) {
        try {
            if (Thread.currentThread().isInterrupted()) throw TypesenseException.unavailable();
            var result=restClient.post().uri("/collections/{collection}/documents/import?action=upsert", collection)
                    .contentType(MediaType.parseMediaType("text/plain; charset=UTF-8")).body(body)
                    .exchange((request, response) -> {
                        if (!response.getStatusCode().is2xxSuccessful()) throw TypesenseException.unavailable();
                        var input = new java.io.BufferedInputStream(response.getBody());
                        var acknowledgements = new java.util.ArrayList<ImportAck>();
                        long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.MILLISECONDS.toNanos(READ_TIMEOUT_MS);
                        for (String id : ids) {
                            String line = boundedLine(input,deadline);
                            if (line == null) throw TypesenseException.invalidResponse();
                            var ack = objectMapper.readTree(line);
                            if (ack == null || !ack.isObject() || !ack.path("success").isBoolean()) throw TypesenseException.invalidResponse();
                            boolean success = ack.path("success").asBoolean();
                            acknowledgements.add(new ImportAck(id, success, success ? null : "IMPORT_REJECTED"));
                        }
                        if (boundedLine(input,deadline) != null) throw TypesenseException.invalidResponse();
                        return List.copyOf(acknowledgements);
                    });
            long succeeded=result.stream().filter(ImportAck::success).count();
            metrics.imported(true,succeeded);metrics.imported(false,result.size()-succeeded);
            return result;
        } catch (TypesenseException safe) { metrics.imported(false,ids.size());throw safe; }
        catch (Exception failure) { metrics.imported(false,ids.size());throw TypesenseException.invalidResponse(); }
    }

    static String boundedLine(java.io.InputStream input,long deadline) throws java.io.IOException {
        var bytes = new java.io.ByteArrayOutputStream();
        for (;;) {
            if (Thread.currentThread().isInterrupted() || System.nanoTime()>=deadline) throw TypesenseException.unavailable();
            int value=input.read();
            if (value==-1) break;
            if (value == '\n') return bytes.toString(java.nio.charset.StandardCharsets.UTF_8);
            if (bytes.size() == 1_048_576) throw TypesenseException.invalidResponse();
            bytes.write(value);
        }
        return bytes.size() == 0 ? null : bytes.toString(java.nio.charset.StandardCharsets.UTF_8);
    }

    private static final class LimitedOutput extends java.io.OutputStream {
        private final java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        private final int limit;
        private boolean exceeded;
        private LimitedOutput(int limit) { this.limit = limit; }
        @Override public void write(int value) throws java.io.IOException {
            if (bytes.size() >= limit) { exceeded = true; throw new java.io.IOException("Document size limit"); }
            bytes.write(value);
        }
        @Override public void write(byte[] values, int offset, int length) throws java.io.IOException {
            if (length > limit - bytes.size()) { exceeded = true; throw new java.io.IOException("Document size limit"); }
            bytes.write(values, offset, length);
        }
    }

    private tools.jackson.databind.JsonNode metadata(String uri, Object... variables) {
        String body = restClient.get().uri(uri, variables).retrieve().body(String.class);
        var value = objectMapper.readTree(body);
        if (value == null || !value.isObject()) throw TypesenseException.invalidResponse();
        return value;
    }

    private boolean matchesSchema(tools.jackson.databind.JsonNode actual, String collection, String entityType, String profile) {
        for (String property : List.of("token_separators", "symbols_to_index")) {
            if (actual.has(property) && (!actual.get(property).isArray() || !actual.get(property).isEmpty())) return false;
        }
        if (actual.has("default_sorting_field") && (!actual.get("default_sorting_field").isString()
                || !actual.get("default_sorting_field").asString().isEmpty())) return false;
        var expected = objectMapper.valueToTree(SearchCollectionSchema.forProfile(collection, entityType, profile)).path("fields");
        if (!actual.path("fields").isArray()) return false;
        Map<String, tools.jackson.databind.JsonNode> fields = new LinkedHashMap<>();
        for (var field : actual.path("fields")) {
            if (!field.path("name").isString() || fields.put(field.path("name").asString(), field) != null) return false;
        }
        fields.remove("id"); // Typesense may include the implicit document identifier.
        if (fields.size() != expected.size()) return false;
        for (var field : expected) {
            var observed = fields.get(field.path("name").asString());
            if (observed == null || !field.path("type").equals(observed.path("type"))) return false;
            boolean numeric = field.path("type").asString().equals("int64");
            for (var property : List.of("optional", "facet", "index", "sort", "store", "stem")) {
                boolean defaultValue = property.equals("index") || property.equals("store") || (property.equals("sort") && numeric);
                boolean wanted = field.has(property) ? field.get(property).asBoolean() : defaultValue;
                if (observed.has(property) && (!observed.get(property).isBoolean() || observed.get(property).asBoolean() != wanted)) return false;
                if (!observed.has(property) && wanted != defaultValue) return false;
            }
            String wantedLocale = field.has("locale") ? field.get("locale").asString() : "";
            if (observed.has("locale") && (!observed.get("locale").isString()
                    || !observed.get("locale").asString().equals(wantedLocale))) return false;
            if (!observed.has("locale") && !wantedLocale.isEmpty()) return false;
        }
        return true;
    }

    private static Long nonnegativeInteger(tools.jackson.databind.JsonNode value, boolean decimalStringAllowed) {
        try {
            if (value.isIntegralNumber() && value.canConvertToLong() && value.asLong() >= 0) return value.asLong();
            if (decimalStringAllowed && value.isString() && value.asString().matches("[0-9]+(?:\\.0+)?")) {
                long result = new java.math.BigDecimal(value.asString()).longValueExact();
                return result >= 0 ? result : null;
            }
        } catch (ArithmeticException overflow) { /* unavailable counter */ }
        return null;
    }

    public record DependencyMetadata(boolean enabled, boolean healthy, String version,
                                     Long installationDiskUsedBytes, Long installationDiskTotalBytes, String errorCode) {}
    public record CollectionMetadata(Long documentCount, Long storageBytes, Boolean schemaMatches, String errorCode) {}
    public record TransportBudgets(int connectTimeoutMs, int readTimeoutMs) {}

    public void upsertDocument(String collection, Map<String, Object> document) {
        if (!properties.enabled()) throw TypesenseException.uninitialized();
        try {
            restClient.post()
                    .uri("/collections/{collection}/documents?action=upsert", collection)
                    .body(document)
                    .retrieve()
                    .toBodilessEntity();
        } catch (Exception e) {
            throw TypesenseException.unavailable();
        }
    }

    public void deleteDocument(String collection, String documentId) {
        if (!properties.enabled()) throw TypesenseException.uninitialized();
        try {
            restClient.delete()
                    .uri("/collections/{collection}/documents/{id}", collection, documentId)
                    .retrieve()
                    .toBodilessEntity();
        } catch (HttpClientErrorException.NotFound missing) {
            // A document 404 is idempotent success only while its collection still exists.
            if (!collectionExists(collection)) throw TypesenseException.uninitialized();
        } catch (Exception e) {
            throw TypesenseException.unavailable();
        }
    }

    public boolean collectionExists(String name) {
        if (!properties.enabled()) throw TypesenseException.uninitialized();
        try {
            restClient.get().uri("/collections/{name}", name).retrieve().toBodilessEntity();
            return true;
        } catch (HttpClientErrorException.NotFound missing) {
            return false;
        } catch (Exception failure) {
            throw TypesenseException.unavailable();
        }
    }

    public void ensureCollection(String name, String entityType) {
        ensureCollection(name, entityType, "MIXED");
    }

    public void ensureCollection(String name, String entityType, String profile) {
        if (collectionExists(name)) return;
        try {
            restClient.post().uri("/collections").body(SearchCollectionSchema.forProfile(name, entityType, profile))
                    .retrieve().toBodilessEntity();
        } catch (Exception failure) {
            throw TypesenseException.unavailable();
        }
    }


    public List<CollectionSearch> multiSearch(
            String query,
            String entityType,
            int limit,
            Map<String, String> collections,
            SearchQueryPolicy policy) {
        if (!properties.enabled()) throw TypesenseException.uninitialized();
        List<String> requestedTypes = requestedTypes(entityType, collections);
        List<Map<String, Object>> searches = requestedTypes.stream()
                .map(type -> searchRequest(query, type, limit, collections, policy))
                .toList();

        try {
            String body = restClient.post()
                    .uri("/multi_search")
                    .body(Map.of("searches", searches))
                    .retrieve()
                    .body(String.class);
            return searchMapper.map(body, requestedTypes);
        } catch (TypesenseException exception) {
            throw exception;
        } catch (Exception transportFailure) {
            throw TypesenseException.unavailable();
        }
    }

    private static List<String> requestedTypes(String entityType, Map<String, String> collections) {
        String normalized = entityType == null ? "ALL" : entityType.toUpperCase(Locale.ROOT);
        if (normalized.equals("ALL")) {
            List<String> types = new ArrayList<>(List.of("TASK", "PROJECT", "USER"));
            if (collections != null && collections.containsKey("NOTE") && !collections.get("NOTE").isBlank()) {
                types.add("NOTE");
            }
            return List.copyOf(types);
        }
        return switch (normalized) {
            case "TASK", "PROJECT", "USER", "NOTE" -> List.of(normalized);
            default -> throw TypesenseException.uninitialized();
        };
    }

    private static Map<String, Object> searchRequest(
            String query,
            String entityType,
            int limit,
            Map<String, String> collections,
            SearchQueryPolicy policy) {
        String collection = collections.get(entityType);
        List<FieldPolicy> fields = policy.fields().get(entityType);
        if (collection == null || collection.isBlank() || fields == null || fields.isEmpty()) {
            throw TypesenseException.uninitialized();
        }
        fields = fields.stream().filter(field -> field.weight() > 0).toList();
        if (fields.isEmpty()) throw TypesenseException.uninitialized();
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("collection", collection);
        request.put("q", query);
        request.put("query_by", join(fields, field -> field.field()));
        request.put("query_by_weights", join(fields, field -> Integer.toString(field.weight())));
        request.put("num_typos", join(fields, field -> Integer.toString(field.numTypos())));
        request.put("prefix", join(fields, field -> Boolean.toString(field.prefix())));
        request.put("prioritize_exact_match", true);
        request.put("highlight_start_tag", "");
        request.put("highlight_end_tag", "");
        request.put("per_page", limit);
        if (entityType.equals("PROJECT") || entityType.equals("USER")) request.put("filter_by", "state:=A");
        return request;
    }

    private static String join(List<FieldPolicy> fields, java.util.function.Function<FieldPolicy, String> mapper) {
        return fields.stream().map(mapper).collect(Collectors.joining(","));
    }

    public record CollectionSearch(String entityType, List<SearchHit> hits, long found, long searchTimeMs) {
        public CollectionSearch {
            hits = List.copyOf(hits);
        }
    }
}

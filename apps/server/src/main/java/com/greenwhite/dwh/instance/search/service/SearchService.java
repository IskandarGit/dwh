package com.greenwhite.dwh.instance.search.service;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.search.repository.SearchFallbackRepository;
import com.greenwhite.dwh.instance.search.repository.SearchFallbackRepository.FallbackSearch;
import com.greenwhite.dwh.instance.search.repository.SearchIndexStateRepository;
import com.greenwhite.dwh.instance.search.repository.SearchIndexStateRepository.IndexSnapshot;
import com.greenwhite.dwh.instance.search.dto.SearchManagementDtos.*;
import com.greenwhite.dwh.instance.search.typesense.TypesenseClient;
import com.greenwhite.dwh.instance.search.typesense.TypesenseClient.CollectionSearch;
import com.greenwhite.dwh.instance.search.typesense.TypesenseException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Supplier;

@Service
public class SearchService {
    private static final Logger log = LoggerFactory.getLogger(SearchService.class);
    private final TypesenseClient typesenseClient;
    private final SearchFallbackRepository fallbackRepository;
    private final SearchAccessPolicy accessPolicy;
    private final SearchResultBudget resultBudget;
    private final Supplier<SearchExecutionSnapshot> executionSnapshot;
    private final Supplier<SettingsSnapshot> fallbackPolicy;
    private final QueryLanguageConverter queryConverter;
    private SearchMetrics metrics = SearchMetrics.unmetered();

    @Autowired
    public SearchService(TypesenseClient typesenseClient, SearchFallbackRepository fallbackRepository,
                         SearchAccessPolicy accessPolicy, SearchResultBudget resultBudget,
                         SearchPolicyProvider policyProvider, SearchExecutionSnapshotReader snapshotReader,
                         java.util.Optional<QueryLanguageConverter> queryConverter,
                         java.util.Optional<SearchMetrics> metrics) {
        this(typesenseClient, fallbackRepository, accessPolicy, resultBudget, policyProvider, snapshotReader,
                queryConverter.orElseGet(QueryLanguageConverter::new));
        this.metrics = metrics.orElseGet(SearchMetrics::unmetered);
    }

    public SearchService(TypesenseClient typesenseClient, SearchFallbackRepository fallbackRepository,
                         SearchAccessPolicy accessPolicy, SearchResultBudget resultBudget,
                         SearchPolicyProvider policyProvider, SearchExecutionSnapshotReader snapshotReader,
                         java.util.Optional<SearchMetrics> metrics) {
        this(typesenseClient, fallbackRepository, accessPolicy, resultBudget, policyProvider, snapshotReader,
                new QueryLanguageConverter());
        this.metrics = metrics.orElseGet(SearchMetrics::unmetered);
    }

    public SearchService(TypesenseClient typesenseClient, SearchFallbackRepository fallbackRepository,
                         SearchAccessPolicy accessPolicy, SearchResultBudget resultBudget,
                         SearchPolicyProvider policyProvider, SearchExecutionSnapshotReader snapshotReader) {
        this(typesenseClient, fallbackRepository, accessPolicy, resultBudget,
                snapshotReader::read, policyProvider::snapshot, new QueryLanguageConverter());
    }

    public SearchService(TypesenseClient typesenseClient, SearchFallbackRepository fallbackRepository,
                         SearchAccessPolicy accessPolicy, SearchResultBudget resultBudget,
                         SearchPolicyProvider policyProvider, SearchExecutionSnapshotReader snapshotReader,
                         QueryLanguageConverter queryConverter) {
        this(typesenseClient, fallbackRepository, accessPolicy, resultBudget,
                snapshotReader::read, policyProvider::snapshot, queryConverter);
    }

    /** Policy/snapshot boundary shared with the later saved-settings provider. */
    protected SearchService(TypesenseClient typesenseClient, SearchFallbackRepository fallbackRepository,
                            SearchAccessPolicy accessPolicy, SearchResultBudget resultBudget,
                            SearchQueryPolicy queryPolicy, Supplier<IndexSnapshot> indexSnapshot) {
        this(typesenseClient, fallbackRepository, accessPolicy, resultBudget,
                () -> new SearchExecutionSnapshot(indexSnapshot.get(), new SettingsSnapshot(1, queryPolicy)),
                () -> new SettingsSnapshot(1, queryPolicy), new QueryLanguageConverter());
    }

    private SearchService(TypesenseClient typesenseClient, SearchFallbackRepository fallbackRepository,
                          SearchAccessPolicy accessPolicy, SearchResultBudget resultBudget,
                          Supplier<SearchExecutionSnapshot> executionSnapshot, Supplier<SettingsSnapshot> fallbackPolicy,
                          QueryLanguageConverter queryConverter) {
        this.typesenseClient = typesenseClient;
        this.fallbackRepository = fallbackRepository;
        this.accessPolicy = accessPolicy;
        this.resultBudget = resultBudget;
        this.executionSnapshot = executionSnapshot;
        this.fallbackPolicy = fallbackPolicy;
        this.queryConverter = queryConverter != null ? queryConverter : new QueryLanguageConverter();
    }

    public SearchResult search(String query, String entityType, int limit) {
        return search(query, entityType, Integer.valueOf(limit));
    }

    public SearchResult search(String query, String entityType, Integer limit) {
        long started=System.nanoTime();
        SearchResult result=null;
        try {
        accessPolicy.requireSearchAccess();
        String cleanQuery = normalizeQuery(query);
        String cleanEntityType = normalizeEntityType(entityType);
        validateLimit(limit);
        SearchExecutionSnapshot snapshot = readSnapshot();
        result=execute(cleanQuery, cleanEntityType, limit, snapshot.index(), snapshot.settings().policy());
        return result;
        } finally {
            metrics.query(entityType==null ? "ALL" : entityType.toUpperCase(Locale.ROOT),result==null ? null : result.source(),
                    result==null,result!=null && result.degraded(),System.nanoTime()-started);
        }
    }

    public PreviewResult preview(PreviewRequest request) {
        long started=System.nanoTime();
        SearchResult result=null;
        try {
        accessPolicy.requireSearchAccess();
        if (request.policy() != null) accessPolicy.requireSettingsRead();
        String query = normalizeQuery(request.q());
        String entity = normalizeEntityType(request.entity());
        SearchExecutionSnapshot snapshot = readSnapshot();
        SearchQueryPolicy policy = request.policy() == null ? snapshot.settings().policy() : request.policy();
        result=execute(query, entity, null, snapshot.index(), policy);
        return new PreviewResult(result, snapshot.index().schemaProfile());
        } finally {
            metrics.query(request==null || request.entity()==null ? "ALL" : request.entity().toUpperCase(Locale.ROOT),
                    result==null ? null : result.source(),result==null,result!=null && result.degraded(),System.nanoTime()-started);
        }
    }

    private SearchExecutionSnapshot readSnapshot() {
        try { return executionSnapshot.get(); }
        catch (org.springframework.dao.DataAccessException unavailable) {
            return new SearchExecutionSnapshot(new IndexSnapshot(null, 0, Map.of(), null, false, false), fallbackPolicy.get());
        }
    }

    private SearchResult execute(String cleanQuery, String cleanEntityType, Integer limit,
                                 IndexSnapshot snapshot, SearchQueryPolicy currentPolicy) {
        int effectiveLimit = limit == null ? currentPolicy.globalLimit() : effectiveLimit(limit, currentPolicy);

        Long exactId = exactId(cleanQuery);
        if (exactId != null) {
            try {
                return fallbackResult(cleanQuery, fallbackRepository.searchExact(exactId, cleanEntityType),
                        effectiveLimit, false, true, null);
            } catch (Exception exactFailure) {
                throw unavailable();
            }
        }

        QueryLanguageConverter.QueryExpansion expansion = queryConverter.expand(cleanQuery);
        List<String> queryVariants = expansion.variants();
        String suggestedQuery = expansion.suggestedCorrection();

        if (typesenseClient.isEnabled()) {
            try {
                if (!snapshot.initialized() || !hasCollections(cleanEntityType, snapshot.collections())) {
                    throw TypesenseException.uninitialized();
                }
                List<CollectionSearch> groups = typesenseClient.multiSearch(
                        cleanQuery, cleanEntityType, effectiveLimit, snapshot.collections(), currentPolicy);

                int initialHits = groups.stream().mapToInt(g -> g.hits().size()).sum();
                if (initialHits < effectiveLimit && queryVariants.size() > 1) {
                    for (int i = 1; i < queryVariants.size(); i++) {
                        String variant = queryVariants.get(i);
                        try {
                            List<CollectionSearch> variantGroups = typesenseClient.multiSearch(
                                    variant, cleanEntityType, effectiveLimit, snapshot.collections(), currentPolicy);
                            groups = mergeGroups(groups, variantGroups);
                        } catch (Exception ignored) {}
                    }
                }

                if (cleanEntityType.equals("ALL") && (!snapshot.collections().containsKey("NOTE") || snapshot.collections().get("NOTE").isBlank())) {
                    try {
                        var noteSearch = fallbackRepository.search(cleanQuery, queryVariants, "NOTE", effectiveLimit);
                        if (noteSearch != null && !noteSearch.groups().isEmpty()) {
                            var noteGroup = noteSearch.groups().get(0);
                            if (!noteGroup.hits().isEmpty()) {
                                groups = new ArrayList<>(groups);
                                groups.add(new CollectionSearch("NOTE", noteGroup.hits().stream()
                                        .map(hit -> new SearchHit(hit.entityType(), hit.id(), hit.title(), hit.description(), hit.targetUrl()))
                                        .toList(), noteGroup.hits().size(), 0));
                            }
                        }
                    } catch (Exception ex) {
                        log.debug("Note fallback query for ALL skipped: {}", ex.getMessage());
                    }
                }

                groups.forEach(group -> metrics.engine(group.entityType(), group.searchTimeMs()));
                List<SearchHit> hits = resultBudget.allocate(groups, effectiveLimit);
                long found = sumFound(groups);
                return new SearchResult(cleanQuery, hits.size(), hits, found,
                        found > hits.size(), "TYPESENSE", false, suggestedQuery);
            } catch (TypesenseException | org.springframework.dao.DataAccessException unavailableOrInvalid) {
                log.warn("Typesense search failed; using PostgreSQL fallback");
            }
        }

        try {
            return fallbackResult(cleanQuery, fallbackRepository.search(cleanQuery, queryVariants, cleanEntityType, effectiveLimit),
                    effectiveLimit, true, false, suggestedQuery);
        } catch (Exception fallbackFailure) {
            throw unavailable();
        }
    }

    private List<CollectionSearch> mergeGroups(List<CollectionSearch> primary, List<CollectionSearch> secondary) {
        Map<String, CollectionSearch> map = new LinkedHashMap<>();
        for (CollectionSearch group : primary) {
            map.put(group.entityType(), group);
        }
        for (CollectionSearch sec : secondary) {
            CollectionSearch prim = map.get(sec.entityType());
            if (prim == null) {
                map.put(sec.entityType(), sec);
            } else {
                java.util.Set<String> existingIds = prim.hits().stream().map(SearchHit::id).collect(java.util.stream.Collectors.toSet());
                List<SearchHit> mergedHits = new java.util.ArrayList<>(prim.hits());
                for (SearchHit hit : sec.hits()) {
                    if (existingIds.add(hit.id())) {
                        mergedHits.add(hit);
                    }
                }
                map.put(prim.entityType(), new CollectionSearch(prim.entityType(), mergedHits,
                        Math.max(prim.found(), (long) mergedHits.size()), Math.max(prim.searchTimeMs(), sec.searchTimeMs())));
            }
        }
        return List.copyOf(map.values());
    }

    private SearchResult fallbackResult(String query, FallbackSearch fallback, int effectiveLimit,
                                        boolean degraded, boolean countKnown, String suggestedQuery) {
        List<CollectionSearch> groups = fallback.groups().stream()
                .map(group -> new CollectionSearch(group.entityType(), group.hits().stream()
                        .map(hit -> new SearchHit(hit.entityType(), hit.id(), hit.title(), hit.description(), hit.targetUrl()))
                        .toList(), group.hits().size(), 0))
                .toList();
        List<SearchHit> hits = resultBudget.allocate(groups, effectiveLimit);
        int available = groups.stream().mapToInt(group -> group.hits().size()).sum();
        boolean hasMore = fallback.groups().stream().anyMatch(group -> group.hasMore())
                || available > hits.size();
        Long foundHits = countKnown ? (long) available : null;
        return new SearchResult(query, hits.size(), hits, foundHits, hasMore, "POSTGRES", degraded, suggestedQuery);
    }

    private static int effectiveLimit(int requestedLimit, SearchQueryPolicy queryPolicy) {
        validateLimit(requestedLimit);
        return Math.min(requestedLimit, queryPolicy.globalLimit());
    }

    private static void validateLimit(Integer requestedLimit) {
        if (requestedLimit != null && (requestedLimit < 1 || requestedLimit > 50)) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Лимит поиска должен быть от 1 до 50");
        }
    }

    private static String normalizeQuery(String query) {
        if (query == null) throw invalidQuery();
        String clean = query.trim();
        int length = clean.codePointCount(0, clean.length());
        if (length < 2 || length > 200) throw invalidQuery();
        return clean;
    }

    private static ApiException invalidQuery() {
        return ApiException.badRequest(ErrorCode.EMPTY_QUERY,
                "Поисковый запрос должен содержать от 2 до 200 символов");
    }

    private static String normalizeEntityType(String entityType) {
        if (entityType == null) return "ALL";
        String normalized = entityType.trim().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "ALL", "TASK", "PROJECT", "USER", "NOTE" -> normalized;
            default -> throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Неизвестная категория поиска");
        };
    }

    private static Long exactId(String query) {
        if (!query.matches("#[0-9]+")) return null;
        try {
            long id = Long.parseLong(query.substring(1));
            if (id <= 0) throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "ID должен быть положительным числом");
            return id;
        } catch (NumberFormatException overflow) {
            throw ApiException.badRequest(ErrorCode.BAD_REQUEST, "Некорректный ID поиска");
        }
    }

    private boolean hasCollections(String entityType, Map<String,String> collections) {
        List<String> needed = entityType.equals("ALL") ? List.of("TASK", "PROJECT", "USER") : List.of(entityType);
        return needed.stream().allMatch(type -> collections.containsKey(type) && !collections.get(type).isBlank());
    }

    private static long sumFound(List<CollectionSearch> groups) {
        long total = 0;
        try {
            for (CollectionSearch group : groups) total = Math.addExact(total, group.found());
            return total;
        } catch (ArithmeticException overflow) {
            throw TypesenseException.invalidResponse();
        }
    }

    private static ApiException unavailable() {
        return new ApiException(ErrorCode.SERVICE_UNAVAILABLE, "Поиск временно недоступен");
    }

    public record SearchHit(String entityType, String id, String title, String description, String targetUrl) {}
    public record SearchResult(String query, int totalHits, List<SearchHit> hits, Long foundHits,
                               boolean hasMore, String source, boolean degraded, String suggestedQuery) {
        public SearchResult { hits = List.copyOf(hits); }
        public SearchResult(String query, int totalHits, List<SearchHit> hits, Long foundHits,
                            boolean hasMore, String source, boolean degraded) {
            this(query, totalHits, hits, foundHits, hasMore, source, degraded, null);
        }
    }
}

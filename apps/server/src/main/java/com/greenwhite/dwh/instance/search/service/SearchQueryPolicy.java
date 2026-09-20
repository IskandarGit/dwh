package com.greenwhite.dwh.instance.search.service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Immutable search behavior policy; never exposes raw Typesense request parameters. */
public record SearchQueryPolicy(
        int globalLimit,
        int requestsPerMinute,
        int burst,
        String schemaProfile,
        Map<String, List<FieldPolicy>> fields) {

    public SearchQueryPolicy {
        if (globalLimit < 1 || globalLimit > 50) throw new IllegalArgumentException("Global search limit must be between 1 and 50");
        if (requestsPerMinute < 30 || requestsPerMinute > 600 || burst < 10 || burst > 60 || burst > requestsPerMinute)
            throw new IllegalArgumentException("Invalid search rate budget");
        if (!"MIXED".equals(schemaProfile) && !"RU".equals(schemaProfile)) throw new IllegalArgumentException("Invalid search schema profile");
        if (fields == null || !fields.keySet().containsAll(Set.of("TASK", "PROJECT", "USER"))
                || !Set.of("TASK", "PROJECT", "USER", "NOTE").containsAll(fields.keySet()))
            throw new IllegalArgumentException("Search entities must include TASK, PROJECT, USER and optionally NOTE");
        var copy = new LinkedHashMap<String, List<FieldPolicy>>();
        fields.forEach((entityType, policies) -> {
            Set<String> permitted = switch (entityType) {
                case "TASK" -> Set.of("title", "description_markdown", "status_name", "project_name");
                case "PROJECT" -> Set.of("name", "description");
                case "USER" -> Set.of("name", "login", "email", "phone");
                case "NOTE" -> Set.of("title", "content_md", "color");
                default -> throw new IllegalArgumentException("Unknown search entity");
            };
            if (policies == null || policies.size() != permitted.size() || policies.stream().anyMatch(java.util.Objects::isNull)
                    || !policies.stream().map(FieldPolicy::field).collect(java.util.stream.Collectors.toSet()).equals(permitted)
                    || policies.stream().noneMatch(field -> field.weight() > 0))
                throw new IllegalArgumentException("Each searchable field is required exactly once with at least one positive weight");
            copy.put(entityType, List.copyOf(policies));
        });
        fields = java.util.Collections.unmodifiableMap(copy);
    }

    public static SearchQueryPolicy defaults() {
        var fields = new LinkedHashMap<String, List<FieldPolicy>>();
        fields.put("TASK", List.of(
                new FieldPolicy("title", 10, 2, true),
                new FieldPolicy("description_markdown", 3, 2, true),
                new FieldPolicy("status_name", 2, 2, true),
                new FieldPolicy("project_name", 2, 2, true)));
        fields.put("PROJECT", List.of(
                new FieldPolicy("name", 10, 2, true),
                new FieldPolicy("description", 3, 2, true)));
        fields.put("USER", List.of(
                new FieldPolicy("name", 10, 2, true),
                new FieldPolicy("login", 8, 0, true),
                new FieldPolicy("email", 6, 0, true),
                new FieldPolicy("phone", 6, 0, true)));
        return new SearchQueryPolicy(10, 120, 20, "MIXED", fields);
    }
}

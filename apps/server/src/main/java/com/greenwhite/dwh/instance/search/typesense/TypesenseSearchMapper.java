package com.greenwhite.dwh.instance.search.typesense;

import com.greenwhite.dwh.instance.search.service.SearchService.SearchHit;
import com.greenwhite.dwh.instance.search.typesense.TypesenseClient.CollectionSearch;
import org.springframework.web.util.HtmlUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.List;

/** Strictly validates and maps one Typesense multi-search response as one atomic operation. */
public final class TypesenseSearchMapper {

    private static final int MAX_SNIPPET_CODE_POINTS = 240;

    private final ObjectMapper objectMapper;

    public TypesenseSearchMapper(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public List<CollectionSearch> map(String body, List<String> entityTypes) {
        if (body == null || body.isBlank()) throw TypesenseException.invalidResponse();
        try {
            JsonNode root = objectMapper.readTree(body);
            JsonNode results = root.get("results");
            if (results == null || !results.isArray() || results.size() != entityTypes.size()) {
                throw TypesenseException.invalidResponse();
            }
            List<CollectionSearch> mapped = new ArrayList<>(entityTypes.size());
            for (int i = 0; i < entityTypes.size(); i++) {
                mapped.add(mapCollection(entityTypes.get(i), results.get(i)));
            }
            return List.copyOf(mapped);
        } catch (TypesenseException exception) {
            throw exception;
        } catch (Exception invalidJsonOrShape) {
            throw TypesenseException.invalidResponse();
        }
    }

    private CollectionSearch mapCollection(String entityType, JsonNode result) {
        if (result == null || !result.isObject() || result.has("error") || result.has("code")) {
            throw TypesenseException.invalidResponse();
        }
        long found = requiredNonNegativeLong(result, "found");
        long searchTimeMs = requiredNonNegativeLong(result, "search_time_ms");
        JsonNode hitsNode = result.get("hits");
        if (hitsNode == null || !hitsNode.isArray() || found < hitsNode.size()) {
            throw TypesenseException.invalidResponse();
        }
        List<SearchHit> hits = new ArrayList<>(hitsNode.size());
        for (JsonNode hit : hitsNode) hits.add(mapHit(entityType, hit));
        return new CollectionSearch(entityType, hits, found, searchTimeMs);
    }

    private SearchHit mapHit(String entityType, JsonNode hit) {
        if (hit == null || !hit.isObject()) throw TypesenseException.invalidResponse();
        JsonNode document = hit.get("document");
        if (document == null || !document.isObject()) throw TypesenseException.invalidResponse();
        return switch (entityType) {
            case "TASK" -> task(hit, document);
            case "PROJECT" -> project(hit, document);
            case "USER" -> user(hit, document);
            case "NOTE" -> note(hit, document);
            default -> throw TypesenseException.invalidResponse();
        };
    }

    private SearchHit note(JsonNode hit, JsonNode document) {
        long id = requiredDocumentId(document, "note_id");
        String title = requiredText(document, "title");
        String fallback = optionalText(document, "content_md");
        return new SearchHit("NOTE", Long.toString(id), title,
                snippet(hit, fallback), "/notes?id=" + id);
    }

    private SearchHit task(JsonNode hit, JsonNode document) {
        long id = requiredDocumentId(document, "task_id");
        String title = requiredText(document, "title");
        String fallback = optionalText(document, "description_markdown");
        if (fallback.isBlank()) fallback = taskMetadata(document);
        return new SearchHit("TASK", Long.toString(id), title,
                snippet(hit, fallback), "/tasks/items/" + id);
    }

    private SearchHit project(JsonNode hit, JsonNode document) {
        requireActive(document);
        long id = requiredDocumentId(document, "project_id");
        return new SearchHit("PROJECT", Long.toString(id), requiredText(document, "name"),
                snippet(hit, optionalText(document, "description")), "/tasks/projects/" + id);
    }

    private SearchHit user(JsonNode hit, JsonNode document) {
        requireActive(document);
        long id = requiredDocumentId(document, "user_id");
        String login = requiredText(document, "login");
        String email = requiredText(document, "email");
        String fallback = email + " (@" + login + ")";
        return new SearchHit("USER", Long.toString(id), requiredText(document, "name"),
                snippet(hit, fallback), "/iam/users/" + id);
    }

    private static long requiredDocumentId(JsonNode document, String typedIdField) {
        long typedId = positiveLong(document.get(typedIdField));
        long stringId = positiveLong(document.get("id"));
        if (typedId != stringId) throw TypesenseException.invalidResponse();
        return typedId;
    }

    private static long positiveLong(JsonNode value) {
        if (value == null || (!value.isIntegralNumber() && !value.isTextual())) {
            throw TypesenseException.invalidResponse();
        }
        String text = value.isTextual() ? value.textValue() : value.asText();
        try {
            long parsed = Long.parseLong(text);
            if (parsed <= 0) throw TypesenseException.invalidResponse();
            return parsed;
        } catch (NumberFormatException invalidId) {
            throw TypesenseException.invalidResponse();
        }
    }

    private static long requiredNonNegativeLong(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || !value.isIntegralNumber() || !value.canConvertToLong()) {
            throw TypesenseException.invalidResponse();
        }
        long parsed = value.longValue();
        if (parsed < 0) throw TypesenseException.invalidResponse();
        return parsed;
    }

    private static String requiredText(JsonNode document, String field) {
        JsonNode value = document.get(field);
        if (value == null || !value.isTextual() || value.textValue().isBlank()) {
            throw TypesenseException.invalidResponse();
        }
        return value.textValue();
    }

    private static String optionalText(JsonNode document, String field) {
        JsonNode value = document.get(field);
        if (value == null || value.isNull()) return "";
        if (!value.isTextual()) throw TypesenseException.invalidResponse();
        return value.textValue();
    }

    private static void requireActive(JsonNode document) {
        if (!"A".equals(requiredText(document, "state"))) throw TypesenseException.invalidResponse();
    }

    private static String taskMetadata(JsonNode document) {
        String status = optionalText(document, "status_name");
        String priority = optionalText(document, "priority");
        String project = optionalText(document, "project_name");
        StringBuilder description = new StringBuilder();
        if (!status.isBlank()) description.append("Статус: ").append(status);
        if (!priority.isBlank()) appendPart(description, "Приоритет: " + priority);
        if (!project.isBlank()) appendPart(description, "Проект: " + project);
        return description.toString();
    }

    private static void appendPart(StringBuilder text, String part) {
        if (!text.isEmpty()) text.append(" | ");
        text.append(part);
    }

    private static String snippet(JsonNode hit, String fallback) {
        String objectHighlight = highlightedText(hit.get("highlight"));
        String arrayHighlight = highlightsArrayText(hit.get("highlights"));
        String highlighted = objectHighlight == null ? arrayHighlight : objectHighlight;
        return boundedPlaintext(highlighted == null ? fallback : highlighted);
    }

    private static String highlightedText(JsonNode highlight) {
        if (highlight == null || highlight.isNull()) return null;
        if (!highlight.isObject()) throw TypesenseException.invalidResponse();
        String firstText = null;
        var fields = highlight.properties().iterator();
        while (fields.hasNext()) {
            JsonNode value = fields.next().getValue();
            if (value == null || !value.isObject()) throw TypesenseException.invalidResponse();
            String text = requiredHighlightText(value);
            if (firstText == null) firstText = text;
        }
        return firstText;
    }

    private static String highlightsArrayText(JsonNode highlights) {
        if (highlights == null || highlights.isNull()) return null;
        if (!highlights.isArray()) throw TypesenseException.invalidResponse();
        String firstText = null;
        for (JsonNode value : highlights) {
            if (value == null || !value.isObject()) throw TypesenseException.invalidResponse();
            String text = requiredHighlightText(value);
            if (firstText == null) firstText = text;
        }
        return firstText;
    }

    private static String requiredHighlightText(JsonNode value) {
        JsonNode snippet = value.get("snippet");
        JsonNode matched = value.get("value");
        if (snippet != null && !snippet.isTextual()) throw TypesenseException.invalidResponse();
        if (matched != null && !matched.isTextual()) throw TypesenseException.invalidResponse();
        if (snippet == null && matched == null) throw TypesenseException.invalidResponse();
        return snippet == null ? matched.textValue() : snippet.textValue();
    }

    static String boundedPlaintext(String value) {
        if (value == null || value.isEmpty()) return "";
        String decoded = HtmlUtils.htmlUnescape(value);
        String plaintext = decoded.replaceAll("(?s)<[^>]*>", "")
                .replaceAll("[\\p{Cntrl}&&[^\\r\\n\\t]]", "")
                .strip();
        int codePoints = plaintext.codePointCount(0, plaintext.length());
        if (codePoints <= MAX_SNIPPET_CODE_POINTS) return plaintext;
        int end = plaintext.offsetByCodePoints(0, MAX_SNIPPET_CODE_POINTS);
        return plaintext.substring(0, end);
    }
}

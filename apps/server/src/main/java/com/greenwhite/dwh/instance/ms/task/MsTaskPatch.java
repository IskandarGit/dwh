package com.greenwhite.dwh.instance.ms.task;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Presence-aware values for the public task PATCH contract. */
public record MsTaskPatch(
        boolean projectIdPresent,
        Long projectId,
        boolean titlePresent,
        String title,
        boolean descriptionMarkdownPresent,
        String descriptionMarkdown,
        boolean parentTaskIdPresent,
        Long parentTaskId,
        boolean priorityPresent,
        String priority,
        boolean responsibleUserIdPresent,
        Long responsibleUserId,
        boolean executorUserIdsPresent,
        List<Long> executorUserIds,
        boolean observerUserIdsPresent,
        List<Long> observerUserIds,
        boolean attributesPresent,
        Map<String, Object> attributes,
        boolean beginTimePresent,
        Instant beginTime,
        boolean endTimePresent,
        Instant endTime,
        boolean expectedRevisionPresent,
        Long expectedRevision
) {
    public MsTaskPatch(
            boolean projectIdPresent,
            Long projectId,
            boolean titlePresent,
            String title,
            boolean descriptionMarkdownPresent,
            String descriptionMarkdown,
            boolean parentTaskIdPresent,
            Long parentTaskId,
            boolean priorityPresent,
            String priority,
            boolean responsibleUserIdPresent,
            Long responsibleUserId,
            boolean executorUserIdsPresent,
            List<Long> executorUserIds,
            boolean observerUserIdsPresent,
            List<Long> observerUserIds,
            boolean attributesPresent,
            Map<String, Object> attributes,
            boolean beginTimePresent,
            Instant beginTime,
            boolean endTimePresent,
            Instant endTime
    ) {
        this(projectIdPresent, projectId, titlePresent, title, descriptionMarkdownPresent, descriptionMarkdown,
                parentTaskIdPresent, parentTaskId, priorityPresent, priority, responsibleUserIdPresent, responsibleUserId,
                executorUserIdsPresent, executorUserIds, observerUserIdsPresent, observerUserIds,
                attributesPresent, attributes, beginTimePresent, beginTime, endTimePresent, endTime,
                false, null);
    }
}

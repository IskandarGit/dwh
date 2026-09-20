package com.greenwhite.dwh.instance.md.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

public final class MdOrgUnitDtos {

    private MdOrgUnitDtos() {
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record UserAssignments(Long userId, List<Long> orgUnitIds, Long legacyOrgUnitId) {
        public UserAssignments {
            orgUnitIds = List.copyOf(orgUnitIds);
        }
    }

    public record RoleRule(Long roleId, String rule) {
    }
}

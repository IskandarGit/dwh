package com.greenwhite.dwh.instance.upl.api;

import com.greenwhite.dwh.instance.common.annotation.RequiresPermission;
import com.greenwhite.dwh.instance.fnd.units.FndUnitService;
import com.greenwhite.dwh.instance.upl.UplPref;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.Map;

/** Единицы экземпляра для экрана анкеты (К-1, И4): имя — ru, иначе uz, иначе код. */
@RestController
@RequestMapping("/api/v1/upl/units")
public class UplUnitController {

    private static final String RU = "ru";
    private static final String UZ = "uz";

    private final FndUnitService units;
    private final ObjectMapper json;

    public UplUnitController(FndUnitService units, ObjectMapper json) {
        this.units = units;
        this.json = json;
    }

    @GetMapping
    @RequiresPermission(form = UplPref.FORM_SOURCES, action = UplPref.ACTION_VIEW)
    public ResponseEntity<List<UnitItem>> list() {
        List<UnitItem> items = units.listUnits().stream()
                .map(u -> new UnitItem(u.code(), displayName(u.code(), names(u.nameI18n())), u.baseUnitCode()))
                .toList();
        return ResponseEntity.ok(items);
    }

    /** ru → uz → код; пустые строки считаются отсутствием имени. */
    public static String displayName(String code, Map<String, String> names) {
        String ru = names.get(RU);
        if (ru != null && !ru.isBlank()) {
            return ru;
        }
        String uz = names.get(UZ);
        if (uz != null && !uz.isBlank()) {
            return uz;
        }
        return code;
    }

    private Map<String, String> names(String nameI18n) {
        if (nameI18n == null || nameI18n.isBlank()) {
            return Map.of();
        }
        return json.readValue(nameI18n, new TypeReference<Map<String, String>>() { });
    }

    /** Единица для выпадающего списка: код, имя на языке пользователя и код базовой единицы. */
    public record UnitItem(String code, String name, String baseUnitCode) {
    }
}

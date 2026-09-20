package com.greenwhite.dwh.instance.md;

import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.md.repository.MdCustomFieldRepository;
import com.greenwhite.dwh.instance.md.service.MdCustomFieldService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

class MdCustomFieldServiceTest {

    private final MdCustomFieldRepository customFieldRepository = Mockito.mock(MdCustomFieldRepository.class);
    private final MdCustomFieldService service = new MdCustomFieldService(customFieldRepository, Mockito.mock(com.greenwhite.dwh.instance.audit.service.AuditLogService.class));

    @Test
    @DisplayName("Валидация динамических полей должна отклонять отсутствующие обязательные поля")
    void shouldRejectMissingRequiredField() {
        when(customFieldRepository.findByEntityType("USER")).thenReturn(List.of(
                new MdCustomFieldRepository.CustomFieldRecord(
                        1L, "USER", "inn", "ИНН", "number", true, null, "[]", 0, Instant.now()
                )
        ));

        assertThatThrownBy(() -> service.validateAttributes("USER", Map.of()))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Ошибка валидации динамических атрибутов");
    }

    @Test
    @DisplayName("Валидация динамических полей должна успешно проходить при корректных типах")
    void shouldPassValidAttributes() {
        when(customFieldRepository.findByEntityType("USER")).thenReturn(List.of(
                new MdCustomFieldRepository.CustomFieldRecord(
                        1L, "USER", "inn", "ИНН", "number", true, null, "[]", 0, Instant.now()
                ),
                new MdCustomFieldRepository.CustomFieldRecord(
                        2L, "USER", "is_vip", "VIP клиент", "boolean", false, "false", "[]", 1, Instant.now()
                ),
                new MdCustomFieldRepository.CustomFieldRecord(
                        3L, "USER", "birth_date", "Дата рождения", "date", false, null, "[]", 2, Instant.now()
                )
        ));

        assertThatCode(() -> service.validateAttributes("USER", Map.of(
                "inn", 123456789,
                "is_vip", true,
                "birth_date", "2026-08-29"
        ))).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("Валидация должна отклонять невалидный формат числа и даты")
    void shouldRejectInvalidDataFormats() {
        when(customFieldRepository.findByEntityType("TASK")).thenReturn(List.of(
                new MdCustomFieldRepository.CustomFieldRecord(
                        1L, "TASK", "deadline", "Срок", "date", false, null, "[]", 0, Instant.now()
                ),
                new MdCustomFieldRepository.CustomFieldRecord(
                        2L, "TASK", "cost", "Стоимость", "number", false, null, "[]", 1, Instant.now()
                )
        ));

        assertThatThrownBy(() -> service.validateAttributes("TASK", Map.of("deadline", "invalid-date")))
                .isInstanceOf(ApiException.class);

        assertThatThrownBy(() -> service.validateAttributes("TASK", Map.of("cost", "not_a_number")))
                .isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("Валидация select должна проверять допустимость значения по options_json")
    void shouldValidateSelectOptions() {
        when(customFieldRepository.findByEntityType("TASK")).thenReturn(List.of(
                new MdCustomFieldRepository.CustomFieldRecord(
                        1L, "TASK", "priority_level", "Уровень", "select", false, null, "[\"low\", \"medium\", \"high\"]", 0, Instant.now()
                )
        ));

        assertThatCode(() -> service.validateAttributes("TASK", Map.of("priority_level", "medium")))
                .doesNotThrowAnyException();

        assertThatThrownBy(() -> service.validateAttributes("TASK", Map.of("priority_level", "super_critical")))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Ошибка валидации динамических атрибутов");
    }

    @Test
    @DisplayName("Валидация string должна проверять ограничение длины")
    void shouldRejectTooLongString() {
        when(customFieldRepository.findByEntityType("NOTE")).thenReturn(List.of(
                new MdCustomFieldRepository.CustomFieldRecord(
                        1L, "NOTE", "memo", "Заметка", "string", false, null, "[]", 0, Instant.now()
                )
        ));

        String longStr = "x".repeat(4001);
        assertThatThrownBy(() -> service.validateAttributes("NOTE", Map.of("memo", longStr)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("Создание поля должно отклонять зарезервированные имена и некорректный slug")
    void shouldRejectInvalidOrReservedCode() {
        assertThatThrownBy(() -> service.createField("TASK", "id", "Идентификатор", "number", false, null, null, 0))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("зарезервирован");

        assertThatThrownBy(() -> service.createField("TASK", "invalid code!", "Невалидный", "string", false, null, null, 0))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Код поля должен начинаться с буквы");

        assertThatThrownBy(() -> service.createField("TASK", "valid_code", "Валидный", "unknown_type", false, null, null, 0))
                .isInstanceOf(ApiException.class)
                .hasMessageContaining("Недопустимый тип поля");
    }
}

package com.greenwhite.dwh.instance.support.fixtures;

import org.yaml.snakeyaml.Yaml;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/**
 * Конфигурация экземпляра для тестов ядра (AC-41; 18 п.12а): единицы, датированные коэффициенты, загрузки.
 * Читается из тест-ресурсов {@code fixtures/dept-a.yaml}, {@code fixtures/dept-b.yaml}; в {@code src/main}
 * фикстур нет (это подтверждает grep AC-40). Порядок элементов закреплён комментариями в YAML.
 */
public record DepartmentFixture(String name, List<Unit> units, List<Coefficient> coefficients, List<Load> loads) {

    public record Unit(String code, String nameUz, String base) {
    }

    public record Coefficient(String from, String to, BigDecimal factor, LocalDate validFrom) {
    }

    public record Load(String source, LocalDate periodFrom, LocalDate periodTo, String format) {
    }

    /** Обе конфигурации — источник для {@code @MethodSource} параметризованных тестов. */
    public static Stream<DepartmentFixture> departments() {
        return Stream.of(load("dept-a"), load("dept-b"));
    }

    @SuppressWarnings("unchecked")
    public static DepartmentFixture load(String name) {
        String resource = "fixtures/" + name + ".yaml";
        try (InputStream in = DepartmentFixture.class.getClassLoader().getResourceAsStream(resource)) {
            if (in == null) {
                throw new IllegalStateException("Фикстура не найдена: " + resource);
            }
            Map<String, Object> root = new Yaml().load(in);
            List<Unit> units = ((List<Map<String, Object>>) root.get("units")).stream()
                    .map(u -> new Unit(text(u, "code"), text(u, "name_uz"), text(u, "base")))
                    .toList();
            List<Coefficient> coefficients = ((List<Map<String, Object>>) root.get("coefficients")).stream()
                    .map(c -> new Coefficient(text(c, "from"), text(c, "to"),
                            new BigDecimal(text(c, "factor")), date(c, "valid_from")))
                    .toList();
            List<Load> loads = ((List<Map<String, Object>>) root.get("loads")).stream()
                    .map(l -> new Load(text(l, "source"), date(l, "period_from"), date(l, "period_to"),
                            text(l, "format")))
                    .toList();
            DepartmentFixture fixture = new DepartmentFixture(text(root, "name"), units, coefficients, loads);
            fixture.validate();
            return fixture;
        } catch (IOException e) {
            throw new IllegalStateException("Не прочитана фикстура " + resource, e);
        }
    }

    // ---------- именованные элементы по порядку в YAML ----------

    /** Базовая единица (первая в списке, ссылается сама на себя). */
    public Unit baseUnit() {
        return units.get(0);
    }

    /** Производная единица (вторая), её базовая — {@link #baseUnit()}. */
    public Unit derivedUnit() {
        return units.get(1);
    }

    /** Отдельная базовая единица (третья) — для пары без коэффициента. */
    public Unit otherUnit() {
        return units.get(2);
    }

    /** Первое значение коэффициента «производная → базовая». */
    public Coefficient firstCoefficient() {
        return coefficients.get(0);
    }

    /** Второе, более позднее значение той же пары. */
    public Coefficient secondCoefficient() {
        return coefficients.get(1);
    }

    /** Основная загрузка: источник и период. */
    public Load mainLoad() {
        return loads.get(0);
    }

    /** Другой источник за тот же период. */
    public Load otherSourceLoad() {
        return loads.get(1);
    }

    /** Тот же источник за другой период. */
    public Load otherPeriodLoad() {
        return loads.get(2);
    }

    @Override
    public String toString() {
        return name;
    }

    private void validate() {
        if (units.size() < 3 || coefficients.size() < 2 || loads.size() < 3) {
            throw new IllegalStateException("Фикстура " + name + ": нужны ≥3 единиц, ≥2 коэффициентов, ≥3 загрузок");
        }
        if (!baseUnit().base().equals(baseUnit().code()) || !derivedUnit().base().equals(baseUnit().code())
                || !otherUnit().base().equals(otherUnit().code())) {
            throw new IllegalStateException("Фикстура " + name + ": порядок единиц — базовая, производная, отдельная");
        }
        for (Coefficient c : coefficients) {
            if (!c.from().equals(derivedUnit().code()) || !c.to().equals(baseUnit().code())) {
                throw new IllegalStateException("Фикстура " + name + ": коэффициенты — только пара производная → базовая");
            }
        }
        if (!firstCoefficient().validFrom().isBefore(secondCoefficient().validFrom())) {
            throw new IllegalStateException("Фикстура " + name + ": второй коэффициент должен быть позже первого");
        }
        if (!mainLoad().source().equals(otherPeriodLoad().source()) || mainLoad().source().equals(otherSourceLoad().source())
                || !mainLoad().periodFrom().equals(otherSourceLoad().periodFrom())
                || mainLoad().periodFrom().equals(otherPeriodLoad().periodFrom())) {
            throw new IllegalStateException("Фикстура " + name + ": загрузки — основная, другой источник, другой период");
        }
    }

    private static String text(Map<String, Object> map, String key) {
        Object value = map.get(key);
        if (value == null) {
            throw new IllegalStateException("В фикстуре нет поля " + key);
        }
        return String.valueOf(value);
    }

    private static LocalDate date(Map<String, Object> map, String key) {
        Object value = map.get(key);
        if (value instanceof java.util.Date d) {
            return d.toInstant().atZone(java.time.ZoneOffset.UTC).toLocalDate();
        }
        return LocalDate.parse(text(map, key));
    }
}

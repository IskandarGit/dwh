package com.greenwhite.dwh.instance.fnd.migration;

import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigInteger;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Каталог версионных миграций одной БД на classpath: имена файлов и последняя ожидаемая версия.
 * Не зависит от Flyway — используется и мигратором, и {@link DwhSchemaVersionGate} (AC-4).
 */
public final class MigrationCatalog {

    private static final Pattern VERSIONED = Pattern.compile("^V(\\d+)__.+\\.sql$");

    private final String location;
    private final List<String> fileNames;

    private MigrationCatalog(String location, List<String> fileNames) {
        this.location = location;
        this.fileNames = fileNames;
    }

    /** Читает каталог {@code classpath:<location>/V*.sql}; каталог без файлов — ошибка конфигурации. */
    public static MigrationCatalog onClasspath(String location) {
        try {
            Resource[] resources = new PathMatchingResourcePatternResolver()
                    .getResources("classpath*:" + location + "/V*.sql");
            List<String> names = Arrays.stream(resources)
                    .map(Resource::getFilename)
                    .filter(Objects::nonNull)
                    .sorted()
                    .toList();
            if (names.isEmpty()) {
                throw new IllegalStateException("Каталог миграций пуст: " + location);
            }
            return new MigrationCatalog(location, names);
        } catch (IOException e) {
            throw new UncheckedIOException("Не удалось прочитать каталог миграций " + location, e);
        }
    }

    public String location() {
        return location;
    }

    public List<String> fileNames() {
        return fileNames;
    }

    /** Наибольшая версия каталога в нормализованном виде (как хранит Flyway: без ведущих нулей). */
    public String latestVersion() {
        return fileNames.stream()
                .map(MigrationCatalog::versionOf)
                .max(BigInteger::compareTo)
                .map(BigInteger::toString)
                .orElseThrow();
    }

    static BigInteger versionOf(String fileName) {
        Matcher m = VERSIONED.matcher(fileName);
        if (!m.matches()) {
            throw new IllegalStateException("Имя миграции не по регламенту: " + fileName);
        }
        return new BigInteger(m.group(1));
    }
}

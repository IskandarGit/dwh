package com.greenwhite.dwh.instance.fnd.files;

import com.greenwhite.dwh.instance.mf.repository.MfFileRepository;
import com.greenwhite.dwh.instance.mf.service.MfFileService;
import com.greenwhite.dwh.instance.support.EmbeddedPostgresTest;
import com.greenwhite.dwh.spi.storage.FileDownloadStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Блок B основы, AC-8: файл загрузки хранит модуль {@code mf} каркаса ({@code mf_files}, SPI {@code StorageProvider},
 * на стенде — {@code LocalStorageProvider}). Основа своего хранилища не имеет (ArchUnit — {@code FndArchitectureTest})
 * и ссылается на файл по {@code sha256} в {@code fnd_load_log.file_sha} (у {@code mf_files.sha256} — unique).
 * Файл 50 МБ — {@code @Tag("perf")}, perf-план.
 */
class FndFileStorageTest extends EmbeddedPostgresTest {

    private static final String MIME = "application/octet-stream";

    @Autowired
    private MfFileService files;
    @Autowired
    private JdbcClient jdbc;
    @Autowired
    private TransactionTemplate tx;
    @Value("${dwh.storage.local-path}")
    private String storagePath;

    private long ownerA;
    private long ownerB;

    @BeforeEach
    void owners() {
        ownerA = userId("fnd-files-a");
        ownerB = userId("fnd-files-b");
        tx.executeWithoutResult(status -> jdbc.sql("delete from mf_files where created_by in (:a, :b)")
                .param("a", ownerA).param("b", ownerB).update());
    }

    @ParameterizedTest(name = "{0}")
    @ValueSource(strings = {"Ғишт-ҳисобот.xlsx", "G'isht-hisobot.xlsx"})
    @DisplayName("AC-8: 1 байт и 8 МБ + 1 байт с узбекскими именами — скачанные байты и sha256 совпадают")
    void roundTrip(String name) throws IOException {
        for (byte[] content : List.of(new byte[] {'x'}, payload(8 * 1024 * 1024 + 1))) {
            MfFileRepository.FileRecord record = files.uploadFile(name, MIME,
                    new ByteArrayInputStream(content), content.length, ownerA);

            assertThat(record.originalName()).isEqualTo(name);
            assertThat(record.sizeBytes()).isEqualTo(content.length);
            assertThat(record.sha256()).isEqualTo(sha256(content));
            try (FileDownloadStream download = files.downloadFile(record.id(), ownerA)) {
                assertThat(download.inputStream().readAllBytes()).isEqualTo(content);
            }
        }
    }

    @Test
    @DisplayName("AC-8: то же содержимое повторно — та же sha256 и один физический файл; новая ссылка у другого владельца")
    void sameContentIsDeduplicated() throws IOException {
        byte[] content = payload(4096);
        MfFileRepository.FileRecord first = files.uploadFile("birinchi.xlsx", MIME,
                new ByteArrayInputStream(content), content.length, ownerA);
        Path stored = storedFile(first.sha256());
        FileTime storedAt = Files.getLastModifiedTime(stored);

        MfFileRepository.FileRecord again = files.uploadFile("ikkinchi.xlsx", MIME,
                new ByteArrayInputStream(content), content.length, ownerA);
        MfFileRepository.FileRecord other = files.uploadFile("uchinchi.xlsx", MIME,
                new ByteArrayInputStream(content), content.length, ownerB);

        // Свой повтор каркас отдаёт той же записью, чужой — новой записью владения на тот же объект
        assertThat(again.id()).isEqualTo(first.id());
        assertThat(other.id()).isNotEqualTo(first.id());
        assertThat(other.sha256()).isEqualTo(first.sha256());
        assertThat(other.storageKey()).isEqualTo(first.storageKey());
        assertThat(storedFiles(first.sha256())).hasSize(1);
        assertThat(Files.getLastModifiedTime(stored)).isEqualTo(storedAt);
        assertThat(jdbc.sql("select count(*) from mf_files where sha256 = :sha").param("sha", first.sha256())
                .query(Long.class).single()).isEqualTo(2L);
    }

    @Test
    @DisplayName("AC-8: пустой файл (0 байт) отклоняется с понятной ошибкой и не оставляет записи")
    void emptyFileIsRejected() {
        byte[] empty = new byte[0];
        assertThatThrownBy(() -> files.uploadFile("bosh.xlsx", MIME, new ByteArrayInputStream(empty), 0, ownerA))
                .isInstanceOf(RuntimeException.class)
                .hasMessageMatching("(?s).*(size_bytes|размер|пуст|содержимое).*");
        assertThat(jdbc.sql("select count(*) from mf_files where sha256 = :sha").param("sha", sha256(empty))
                .query(Long.class).single()).isZero();
    }

    // ---------- вспомогательное ----------

    private Path storedFile(String sha256) throws IOException {
        List<Path> found = storedFiles(sha256);
        assertThat(found).as("объект %s на диске", sha256).hasSize(1);
        return found.get(0);
    }

    private List<Path> storedFiles(String sha256) throws IOException {
        try (Stream<Path> tree = Files.walk(Path.of(storagePath))) {
            return tree.filter(Files::isRegularFile)
                    .filter(path -> path.getFileName().toString().equals(sha256))
                    .toList();
        }
    }

    private static byte[] payload(int size) {
        byte[] bytes = new byte[size];
        for (int i = 0; i < size; i++) {
            bytes[i] = (byte) ('A' + (i * 7 + i / 251) % 26);
        }
        return bytes;
    }

    private static String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private long userId(String login) {
        return tx.execute(status -> jdbc.sql("""
                        insert into md_users (name, login, email, state, language, timezone)
                        values ('Тестовый пользователь TEST', :login, :email, 'A', 'uz', 'UTC')
                        on conflict (login) do update set name = excluded.name
                        returning id
                        """)
                .param("login", login).param("email", login + "@localhost")
                .query(Long.class).single());
    }
}

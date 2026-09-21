package com.greenwhite.dwh.instance.mf;

import com.greenwhite.dwh.instance.mf.storage.S3StorageConfiguration;
import com.greenwhite.dwh.instance.mf.storage.S3StorageProperties;
import com.greenwhite.dwh.instance.mf.storage.S3StorageProvider;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.containers.wait.strategy.Wait;
import software.amazon.awssdk.services.s3.model.CreateBucketRequest;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers(disabledWithoutDocker = true)
class S3StorageProviderIntegrationTest {

    private static final String ACCESS_KEY = "smartupcms-test-access";
    private static final String SECRET_KEY = "smartupcms-test-secret";
    private static final String PHYSICAL_BUCKET = "smartupcms-test";

    @Container
    static GenericContainer<?> minio = new GenericContainer<>(
            DockerImageName.parse("quay.io/minio/minio:latest"))
            .withEnv("MINIO_ROOT_USER", ACCESS_KEY)
            .withEnv("MINIO_ROOT_PASSWORD", SECRET_KEY)
            .withCommand("server", "/data")
            .withExposedPorts(9000)
            .waitingFor(Wait.forHttp("/minio/health/ready").forPort(9000));

    @Test
    void performsPortableLifecycleWithLiteralSha256AndSanitizedHealth() throws Exception {
        var properties = new S3StorageProperties();
        properties.setEndpoint(URI.create("http://" + minio.getHost() + ":" + minio.getMappedPort(9000)));
        properties.setRegion("us-east-1");
        properties.setAccessKey(ACCESS_KEY);
        properties.setSecretKey(SECRET_KEY);
        properties.setBucket(PHYSICAL_BUCKET);
        properties.setPathStyleAccess(true);
        properties.setConnectTimeout(Duration.ofSeconds(3));
        properties.setReadTimeout(Duration.ofSeconds(10));

        var configuration = new S3StorageConfiguration();
        try (var client = configuration.s3Client(properties)) {
            client.createBucket(CreateBucketRequest.builder().bucket(PHYSICAL_BUCKET).build());
            var meterRegistry = new SimpleMeterRegistry();
            var provider = new S3StorageProvider(client, properties, meterRegistry);
            byte[] content = "SmartupCMS S3-compatible storage".getBytes(StandardCharsets.UTF_8);

            assertThatThrownBy(() -> provider.upload(
                    "../outside", "unsafe.txt", new ByteArrayInputStream(content),
                    content.length, "text/plain"))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> provider.upload(
                    "instance-files", "wrong-size.txt", new ByteArrayInputStream(content),
                    content.length - 1L, "text/plain"))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("size");

            var uploaded = provider.upload(
                    "instance-files",
                    "documents/release.txt",
                    new ByteArrayInputStream(content),
                    content.length,
                    "text/plain");

            assertThat(uploaded.sha256())
                    .isEqualTo("a67dc620cf85b64aa92ee646186db2114756b9503a29fc3fc26f73ac86239d0d");
            assertThat(uploaded.sizeBytes()).isEqualTo(content.length);
            assertThat(provider.exists("instance-files", "documents/release.txt")).isTrue();

            try (var download = provider.download("instance-files", "documents/release.txt")) {
                assertThat(download).isNotNull();
                assertThat(download.contentLength()).isEqualTo(content.length);
                assertThat(download.contentType()).isEqualTo("text/plain");
                assertThat(download.inputStream().readAllBytes()).isEqualTo(content);
            }

            var health = provider.checkHealth();
            assertThat(health.isHealthy()).isTrue();
            assertThat(health.providerName()).isEqualTo("s3");
            assertThat(health.message())
                    .isEqualTo("OK")
                    .doesNotContain(properties.getEndpoint().toString(), ACCESS_KEY, SECRET_KEY);

            provider.delete("instance-files", "documents/release.txt");
            assertThat(provider.exists("instance-files", "documents/release.txt")).isFalse();
            assertThat(provider.download("instance-files", "documents/release.txt")).isNull();
            assertThat(meterRegistry.get("dwh.storage.operation")
                    .tag("provider", "s3")
                    .tag("operation", "upload")
                    .tag("outcome", "success")
                    .timer().count()).isEqualTo(1);
        }
    }
}

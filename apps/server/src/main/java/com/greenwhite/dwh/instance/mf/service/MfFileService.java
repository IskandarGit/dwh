package com.greenwhite.dwh.instance.mf.service;

import com.greenwhite.dwh.core.error.ErrorCode;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.mf.repository.MfFileRepository;
import com.greenwhite.dwh.instance.md.service.MdScopeService;
import com.greenwhite.dwh.spi.storage.FileDownloadStream;
import com.greenwhite.dwh.spi.storage.FileScanner;
import com.greenwhite.dwh.spi.storage.StorageProvider;
import com.greenwhite.dwh.spi.storage.StoredFileMetadata;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class MfFileService {

    private static final String DEFAULT_BUCKET = "instance-files";
    private static final long MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    private static final Set<String> FORBIDDEN_EXTENSIONS = Set.of(".exe", ".sh", ".bat", ".cmd", ".vbs", ".msi", ".jar");

    private final MfFileMetadataService metadataService;
    private final StorageProvider storageProvider;
    private final FileContentInspector contentInspector;
    private final List<FileScanner> fileScanners;
    private final MfFileObjectLock objectLock;
    private final MdScopeService scopeService;
    private final java.util.concurrent.Semaphore uploadLimiter;

    public static final int DEFAULT_MAX_CONCURRENT_UPLOADS = 10;

    @org.springframework.beans.factory.annotation.Autowired
    public MfFileService(MfFileMetadataService metadataService, StorageProvider storageProvider,
                         FileContentInspector contentInspector,
                         List<FileScanner> fileScanners,
                         MfFileObjectLock objectLock,
                         MdScopeService scopeService,
                         @org.springframework.beans.factory.annotation.Value("${dwh.files.max-concurrent-uploads:10}") int maxConcurrentUploads) {
        this.metadataService = metadataService;
        this.storageProvider = storageProvider;
        this.contentInspector = contentInspector;
        this.fileScanners = List.copyOf(fileScanners);
        this.objectLock = objectLock;
        this.scopeService = scopeService;
        int permits = maxConcurrentUploads > 0 ? maxConcurrentUploads : DEFAULT_MAX_CONCURRENT_UPLOADS;
        this.uploadLimiter = new java.util.concurrent.Semaphore(permits);
    }

    public MfFileService(MfFileMetadataService metadataService, StorageProvider storageProvider,
                         FileContentInspector contentInspector,
                         List<FileScanner> fileScanners,
                         MfFileObjectLock objectLock,
                         MdScopeService scopeService) {
        this(metadataService, storageProvider, contentInspector, fileScanners, objectLock, scopeService, DEFAULT_MAX_CONCURRENT_UPLOADS);
    }

    public MfFileRepository.FileRecord uploadFile(String originalName, String mimeType, InputStream contentStream, long sizeBytes, Long createdBy) {
        if (!uploadLimiter.tryAcquire()) {
            throw ApiException.rateLimited("Превышен лимит одновременных загрузок файлов; пожалуйста, повторите попытку позже");
        }
        try {
            if (sizeBytes > MAX_FILE_SIZE) {
                throw ApiException.badRequest(ErrorCode.FILE_SIZE_EXCEEDED, "Размер файла превышает лимит 50 МБ");
            }

            validateFileExtension(originalName);
            FileContentInspector.Inspection inspection = contentInspector.inspect(mimeType, contentStream);
            String verifiedMimeType = inspection.verifiedMimeType();

            metadataService.validateQuotaSnapshot(createdBy, sizeBytes);

            String tempKey = "temp_" + UUID.randomUUID();
            StoredFileMetadata stored = storageProvider.upload(
                    DEFAULT_BUCKET, tempKey, inspection.content(), sizeBytes, verifiedMimeType);
            RuntimeException uploadFailure = null;
            try {
                return publishQuarantinedFile(
                        originalName, createdBy, tempKey, stored, verifiedMimeType);
            } catch (RuntimeException failure) {
                uploadFailure = failure;
                throw failure;
            } finally {
                deleteQuarantinedObject(tempKey, uploadFailure);
            }
        } finally {
            uploadLimiter.release();
        }
    }

    private MfFileRepository.FileRecord publishQuarantinedFile(
            String originalName, Long createdBy, String tempKey,
            StoredFileMetadata stored, String verifiedMimeType) {
        scanQuarantinedObject(tempKey, stored.sizeBytes(), verifiedMimeType);
        String sha256 = stored.sha256();

        return objectLock.withLock(sha256, () -> publishQuarantinedFileUnderLock(
                originalName, createdBy, tempKey, stored, verifiedMimeType, sha256));
    }

    private MfFileRepository.FileRecord publishQuarantinedFileUnderLock(
            String originalName, Long createdBy, String tempKey,
            StoredFileMetadata stored, String verifiedMimeType, String sha256) {

        // Свою же копию отдаём как есть: повторная загрузка того же файла не
        // плодит записи и не списывает квоту дважды.
        var ownOpt = metadataService.findBySha256AndOwner(sha256, createdBy);
        if (ownOpt.isPresent()) {
            return ownOpt.get();
        }

        // Дедупликация — на уровне физического объекта, не записи владения (V010).
        // Чужую запись возвращать нельзя: её удаление владельцем каскадом снесло
        // бы вложения у всех остальных, а квота второго загрузившего не росла бы.
        String finalKey = sha256.substring(0, 2) + "/" + sha256;
        var sameContent = metadataService.findBySha256(sha256);
        boolean createdPhysicalObject = false;
        if (sameContent.isPresent()) {
            // Объект уже лежит на диске — переиспользуем его ключ.
            finalKey = sameContent.get().storageKey();
        } else {
            if (!storageProvider.exists(DEFAULT_BUCKET, finalKey)) {
                createdPhysicalObject = true;
                copyQuarantinedObject(tempKey, finalKey, stored.sizeBytes(), verifiedMimeType);
            }
        }

        try {
            // Своя запись владения: своё имя файла, своя квота, своё право на удаление.
            return metadataService.publish(
                    sha256,
                    originalName,
                    stored.sizeBytes(),
                    verifiedMimeType,
                    sameContent.map(MfFileRepository.FileRecord::storageBucket).orElse(DEFAULT_BUCKET),
                    finalKey,
                    createdBy);
        } catch (RuntimeException failure) {
            cleanupUnpublishedObject(
                    sha256, DEFAULT_BUCKET, finalKey, createdPhysicalObject, failure);
            throw failure;
        }
    }

    private void copyQuarantinedObject(String tempKey, String finalKey, long sizeBytes, String contentType) {
        try (FileDownloadStream quarantined = storageProvider.download(DEFAULT_BUCKET, tempKey)) {
            if (quarantined == null || quarantined.inputStream() == null) {
                throw new IllegalStateException("Quarantined object is not readable");
            }
            storageProvider.upload(
                    DEFAULT_BUCKET, finalKey, quarantined.inputStream(), sizeBytes, contentType);
        } catch (java.io.IOException exception) {
            throw new IllegalStateException("Failed to close quarantined object stream", exception);
        }
    }

    public StorageStats getStorageStats(Long userId) {
        return metadataService.getStorageStats(userId);
    }

    public java.util.List<MfFileRepository.FileDetailRecord> listFiles(Long userId, boolean onlyMine, String query, int limit) {
        return metadataService.listFiles(
                userId, onlyMine, query, limit, scopeService.filterForFiles(userId));
    }

    public void deleteFile(UUID id, Long currentUserId, boolean canDeleteAny) {
        var scope = scopeService.filterForFiles(currentUserId);
        var snapshot = metadataService.requireFile(id, scope);
        objectLock.withLock(snapshot.sha256(), () -> {
            var deletion = metadataService.delete(id, currentUserId, canDeleteAny, scope);
            if (deletion.deletePhysicalObject()) {
                storageProvider.delete(
                        deletion.file().storageBucket(), deletion.file().storageKey());
            }
        });
    }

    public MfFileRepository.FileRecord getFileMetadata(UUID id) {
        return metadataService.requireFile(id);
    }

    public MfFileRepository.FileRecord getFileMetadata(UUID id, Long currentUserId) {
        return metadataService.requireFile(id, scopeService.filterForFiles(currentUserId));
    }

    public FileDownloadStream downloadFile(UUID id) {
        var metadata = getFileMetadata(id);
        var stream = storageProvider.download(metadata.storageBucket(), metadata.storageKey());
        if (stream == null) {
            throw ApiException.notFound(ErrorCode.FILE_NOT_FOUND, "Физический файл не найден в хранилище");
        }
        return stream;
    }

    public FileDownloadStream downloadFile(UUID id, Long currentUserId) {
        var metadata = getFileMetadata(id, currentUserId);
        var stream = storageProvider.download(metadata.storageBucket(), metadata.storageKey());
        if (stream == null) {
            throw ApiException.notFound(ErrorCode.FILE_NOT_FOUND, "Физический файл не найден в хранилище");
        }
        return stream;
    }

    private void validateFileExtension(String fileName) {
        if (fileName == null) return;
        String lower = fileName.toLowerCase();
        for (String ext : FORBIDDEN_EXTENSIONS) {
            if (lower.endsWith(ext)) {
                throw ApiException.badRequest(ErrorCode.FILE_TYPE_FORBIDDEN, "Загрузка исполняемых файлов (" + ext + ") запрещена правилами безопасности");
            }
        }
    }

    private void scanQuarantinedObject(String tempKey, long sizeBytes, String contentType) {
        for (FileScanner scanner : fileScanners) {
            try (FileDownloadStream quarantined = storageProvider.download(DEFAULT_BUCKET, tempKey)) {
                if (quarantined == null || quarantined.inputStream() == null) {
                    throw new IllegalStateException("Quarantined object is not readable");
                }
                FileScanner.ScanResult result = scanner.scan(
                        quarantined.inputStream(), sizeBytes, contentType);
                if (result == null) {
                    throw new IllegalStateException(
                            "File scanner returned no verdict: " + scanner.getProviderCode());
                }
                if (result.verdict() == FileScanner.Verdict.INFECTED) {
                    throw new ApiException(
                            ErrorCode.FILE_MALWARE_DETECTED,
                            "Файл содержит вредоносное содержимое и был отклонён");
                }
            } catch (ApiException exception) {
                throw exception;
            } catch (Exception exception) {
                throw new ApiException(
                        ErrorCode.FILE_SCAN_FAILED,
                        "Проверка файла не завершена; загрузка отменена");
            }
        }
    }

    private void deleteQuarantinedObject(String tempKey, RuntimeException uploadFailure) {
        try {
            storageProvider.delete(DEFAULT_BUCKET, tempKey);
        } catch (RuntimeException cleanupFailure) {
            if (uploadFailure != null) {
                uploadFailure.addSuppressed(cleanupFailure);
            } else {
                throw cleanupFailure;
            }
        }
    }

    private void cleanupUnpublishedObject(
            String sha256,
            String bucket,
            String key,
            boolean createdPhysicalObject,
            RuntimeException publicationFailure) {
        if (!createdPhysicalObject) {
            return;
        }
        try {
            if (!metadataService.existsBySha256(sha256)) {
                storageProvider.delete(bucket, key);
            }
        } catch (RuntimeException cleanupFailure) {
            // Losing metadata is worse than retaining an orphan object. Preserve
            // the publication error and expose cleanup failure as diagnostics.
            publicationFailure.addSuppressed(cleanupFailure);
        }
    }

    public record StorageStats(
            long companyQuotaBytes,
            long companyUsedBytes,
            long companyAvailableBytes,
            long userQuotaBytes,
            long userUsedBytes,
            long userAvailableBytes,
            int totalFilesCount,
            int userFilesCount
    ) {}
}


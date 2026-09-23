package com.greenwhite.dwh.instance.upl.api;

import com.greenwhite.dwh.core.pagination.KeysetPage;
import com.greenwhite.dwh.instance.common.annotation.RequiresPermission;
import com.greenwhite.dwh.instance.common.security.SecurityContext;
import com.greenwhite.dwh.instance.upl.UplPref;
import com.greenwhite.dwh.instance.upl.api.UplPackageDtos.PackageErrors;
import com.greenwhite.dwh.instance.upl.api.UplPackageDtos.PackageItem;
import com.greenwhite.dwh.instance.upl.upload.UplApplyService;
import com.greenwhite.dwh.instance.upl.upload.UplPackageModel.PackageRow;
import com.greenwhite.dwh.instance.upl.upload.UplPackageService;
import com.greenwhite.dwh.instance.upl.upload.UplUploadService;
import com.greenwhite.dwh.instance.upl.upload.UplUploadService.Upload;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Objects;

/** API загрузок файлов: приём файла, список пакетов и ошибки пакета (контракт И5), применение пакета (И6). */
@RestController
@RequestMapping("/api/v1/upl/packages")
public class UplPackageController {

    private final UplUploadService uploads;
    private final UplPackageService packages;
    private final UplApplyService applies;

    public UplPackageController(UplUploadService uploads, UplPackageService packages, UplApplyService applies) {
        this.uploads = uploads;
        this.packages = packages;
        this.applies = applies;
    }

    private static long userId() {
        return Objects.requireNonNull(SecurityContext.getCurrentUserId(), "user");
    }

    /**
     * Принимает файл: 202 и пакет в статусе «получен». Части запроса не обязательны для каркаса —
     * их отсутствие проверяет сервис и отвечает одним списком ошибок, а не отказом разбора запроса.
     */
    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @RequiresPermission(form = UplPref.FORM_PACKAGES, action = UplPref.ACTION_UPLOAD)
    public ResponseEntity<PackageItem> upload(@RequestParam(required = false) String sourceId,
                                              @RequestParam(required = false) String periodFrom,
                                              @RequestParam(required = false) String periodTo,
                                              @RequestParam(name = "file", required = false) MultipartFile file) {
        Upload upload = new Upload(sourceId, periodFrom, periodTo, file != null,
                file == null ? null : file.getOriginalFilename(),
                file == null ? null : file.getContentType(),
                file == null ? 0L : file.getSize(),
                file);
        PackageRow row = uploads.receive(upload, userId());
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(PackageItem.of(row));
    }

    @GetMapping
    @RequiresPermission(form = UplPref.FORM_PACKAGES, action = UplPref.ACTION_VIEW)
    public ResponseEntity<KeysetPage<PackageItem>> list(@RequestParam(defaultValue = "50") int limit,
                                                        @RequestParam(required = false) String cursor) {
        KeysetPage<PackageRow> page = packages.list(limit, cursor);
        List<PackageItem> items = page.items().stream().map(PackageItem::of).toList();
        return ResponseEntity.ok(KeysetPage.of(items, page.nextCursor(), page.hasMore(), page.totalEstimated()));
    }

    @GetMapping("/{id}/errors")
    @RequiresPermission(form = UplPref.FORM_PACKAGES, action = UplPref.ACTION_VIEW)
    public ResponseEntity<PackageErrors> errors(@PathVariable String id) {
        return ResponseEntity.ok(PackageErrors.of(packages.errors(id)));
    }

    /** Применяет пакет «проверен»: 200 и пакет «применён» или «отклонён системой» с причиной сверки. */
    @PostMapping("/{id}/apply")
    @RequiresPermission(form = UplPref.FORM_PACKAGES, action = UplPref.ACTION_APPLY)
    public ResponseEntity<PackageItem> apply(@PathVariable String id) {
        return ResponseEntity.ok(PackageItem.of(applies.apply(id, userId())));
    }
}

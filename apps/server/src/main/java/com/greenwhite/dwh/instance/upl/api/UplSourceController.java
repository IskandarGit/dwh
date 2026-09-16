package com.greenwhite.dwh.instance.upl.api;

import com.greenwhite.dwh.core.error.FieldErrorItem;
import com.greenwhite.dwh.core.pagination.KeysetPage;
import com.greenwhite.dwh.instance.common.annotation.RequiresPermission;
import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.common.security.SecurityContext;
import com.greenwhite.dwh.instance.upl.UplPref;
import com.greenwhite.dwh.instance.upl.api.UplSourceDtos.CreateDraftRequest;
import com.greenwhite.dwh.instance.upl.api.UplSourceDtos.FormatDraftRequest;
import com.greenwhite.dwh.instance.upl.api.UplSourceDtos.FormatVersionResponse;
import com.greenwhite.dwh.instance.upl.api.UplSourceDtos.PublishRequest;
import com.greenwhite.dwh.instance.upl.api.UplSourceDtos.SourceItem;
import com.greenwhite.dwh.instance.upl.api.UplSourceDtos.SourceRequest;
import com.greenwhite.dwh.instance.upl.api.UplSourceDtos.SourceResponse;
import com.greenwhite.dwh.instance.upl.api.UplSourceDtos.VersionItem;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceSummary;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.Objects;

/** API анкеты файла: источники и версии формата (контракт И3). */
@RestController
@RequestMapping("/api/v1/upl/sources")
public class UplSourceController {

    private static final String VALIDATION_FAILED = "VALIDATION_FAILED";

    private final UplSourceService service;

    public UplSourceController(UplSourceService service) {
        this.service = service;
    }

    private static long userId() {
        return Objects.requireNonNull(SecurityContext.getCurrentUserId(), "user");
    }

    @GetMapping
    @RequiresPermission(form = UplPref.FORM_SOURCES, action = UplPref.ACTION_VIEW)
    public ResponseEntity<KeysetPage<SourceItem>> list(@RequestParam(defaultValue = "50") int limit,
                                                       @RequestParam(required = false) String cursor) {
        KeysetPage<SourceSummary> page = service.listSources(limit, cursor);
        List<SourceItem> items = page.items().stream().map(SourceItem::of).toList();
        return ResponseEntity.ok(KeysetPage.of(items, page.nextCursor(), page.hasMore(), page.totalEstimated()));
    }

    @PostMapping
    @RequiresPermission(form = UplPref.FORM_SOURCES, action = UplPref.ACTION_CREATE)
    public ResponseEntity<SourceResponse> create(@Valid @RequestBody SourceRequest request) {
        var view = service.createSource(request.toData(), userId());
        return ResponseEntity.status(HttpStatus.CREATED).body(SourceResponse.of(view));
    }

    @GetMapping("/{id}")
    @RequiresPermission(form = UplPref.FORM_SOURCES, action = UplPref.ACTION_VIEW)
    public ResponseEntity<SourceResponse> get(@PathVariable long id) {
        return ResponseEntity.ok(SourceResponse.of(service.getSource(id)));
    }

    @PutMapping("/{id}")
    @RequiresPermission(form = UplPref.FORM_SOURCES, action = UplPref.ACTION_EDIT)
    public ResponseEntity<SourceResponse> update(@PathVariable long id, @Valid @RequestBody SourceRequest request) {
        if (request.lockVersion() == null) {
            throw ApiException.validation(VALIDATION_FAILED, List.of(
                    new FieldErrorItem("lockVersion", "REQUIRED", "lockVersion required")));
        }
        var view = service.updateSource(id, request.lockVersion(), request.toData(), userId());
        return ResponseEntity.ok(SourceResponse.of(view));
    }

    @GetMapping("/{id}/format-versions")
    @RequiresPermission(form = UplPref.FORM_SOURCES, action = UplPref.ACTION_VIEW)
    public ResponseEntity<Object> versions(@PathVariable long id,
                                           @RequestParam(required = false)
                                           @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate at) {
        if (at == null) {
            List<VersionItem> items = service.listVersions(id).stream().map(VersionItem::of).toList();
            return ResponseEntity.ok(items);
        }
        return ResponseEntity.ok(FormatVersionResponse.of(service.versionAt(id, at)));
    }

    @PostMapping("/{id}/format-versions")
    @RequiresPermission(form = UplPref.FORM_SOURCES, action = UplPref.ACTION_EDIT)
    public ResponseEntity<FormatVersionResponse> createDraft(@PathVariable long id,
                                                             @Valid @RequestBody(required = false)
                                                             CreateDraftRequest request) {
        Integer copyFrom = request == null ? null : request.copyFrom();
        var draft = service.createDraft(id, copyFrom, userId());
        return ResponseEntity.status(HttpStatus.CREATED).body(FormatVersionResponse.of(draft));
    }

    @GetMapping("/{id}/format-versions/{v}")
    @RequiresPermission(form = UplPref.FORM_SOURCES, action = UplPref.ACTION_VIEW)
    public ResponseEntity<FormatVersionResponse> getVersion(@PathVariable long id, @PathVariable int v) {
        return ResponseEntity.ok(FormatVersionResponse.of(service.getVersion(id, v)));
    }

    @PutMapping("/{id}/format-versions/{v}")
    @RequiresPermission(form = UplPref.FORM_SOURCES, action = UplPref.ACTION_EDIT)
    public ResponseEntity<FormatVersionResponse> replaceDraft(@PathVariable long id, @PathVariable int v,
                                                              @Valid @RequestBody FormatDraftRequest request) {
        var draft = service.replaceDraft(id, v, request.lockVersion(), request.toData(), userId());
        return ResponseEntity.ok(FormatVersionResponse.of(draft));
    }

    @PostMapping("/{id}/format-versions/{v}/publish")
    @RequiresPermission(form = UplPref.FORM_SOURCES, action = UplPref.ACTION_PUBLISH)
    public ResponseEntity<Void> publish(@PathVariable long id, @PathVariable int v,
                                        @Valid @RequestBody PublishRequest request) {
        service.publish(id, v, request.validFrom(), userId());
        return ResponseEntity.noContent().build();
    }
}

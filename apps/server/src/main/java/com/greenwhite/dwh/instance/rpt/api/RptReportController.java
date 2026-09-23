package com.greenwhite.dwh.instance.rpt.api;

import com.greenwhite.dwh.instance.common.annotation.RequiresPermission;
import com.greenwhite.dwh.instance.common.security.SecurityContext;
import com.greenwhite.dwh.instance.rpt.RptModel.CellQuery;
import com.greenwhite.dwh.instance.rpt.RptModel.CellRows;
import com.greenwhite.dwh.instance.rpt.RptModel.Definition;
import com.greenwhite.dwh.instance.rpt.RptModel.DefinitionInput;
import com.greenwhite.dwh.instance.rpt.RptModel.ReportItem;
import com.greenwhite.dwh.instance.rpt.RptModel.ReportView;
import com.greenwhite.dwh.instance.rpt.RptModel.SourceItem;
import com.greenwhite.dwh.instance.rpt.RptModel.SourceLayout;
import com.greenwhite.dwh.instance.rpt.service.RptDefinitionService;
import com.greenwhite.dwh.instance.rpt.service.RptViewService;
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

import java.util.List;
import java.util.Objects;

/** Отчёты (И15а): описание сводного отчёта, расчёт за год, строки ячейки. */
@RestController
@RequestMapping("/api/v1/rpt")
public class RptReportController {

    private final RptDefinitionService definitions;
    private final RptViewService views;

    public RptReportController(RptDefinitionService definitions, RptViewService views) {
        this.definitions = definitions;
        this.views = views;
    }

    private static long userId() {
        return Objects.requireNonNull(SecurityContext.getCurrentUserId(), "user");
    }

    @GetMapping("/reports")
    @RequiresPermission(form = "rpt.reports", action = "view")
    public ResponseEntity<List<ReportItem>> list() {
        return ResponseEntity.ok(definitions.list());
    }

    @GetMapping("/reports/{id}")
    @RequiresPermission(form = "rpt.reports", action = "view")
    public ResponseEntity<Definition> get(@PathVariable long id) {
        return ResponseEntity.ok(definitions.get(id));
    }

    @PostMapping("/reports")
    @RequiresPermission(form = "rpt.reports", action = "edit")
    public ResponseEntity<Definition> create(@RequestBody DefinitionInput input) {
        return ResponseEntity.status(HttpStatus.CREATED).body(definitions.create(input, userId()));
    }

    @PutMapping("/reports/{id}")
    @RequiresPermission(form = "rpt.reports", action = "edit")
    public ResponseEntity<Definition> update(@PathVariable long id, @RequestBody DefinitionInput input) {
        return ResponseEntity.ok(definitions.update(id, input, userId()));
    }

    @GetMapping("/sources")
    @RequiresPermission(form = "rpt.reports", action = "edit")
    public ResponseEntity<List<SourceItem>> sources() {
        return ResponseEntity.ok(definitions.sources());
    }

    @GetMapping("/sources/{sourceId}/layout")
    @RequiresPermission(form = "rpt.reports", action = "edit")
    public ResponseEntity<SourceLayout> layout(@PathVariable long sourceId,
                                               @RequestParam(required = false) Integer sheet) {
        return ResponseEntity.ok(definitions.layout(sourceId, sheet));
    }

    @GetMapping("/reports/{id}/view")
    @RequiresPermission(form = "rpt.reports", action = "view")
    public ResponseEntity<ReportView> view(@PathVariable long id, @RequestParam(required = false) Integer year) {
        return ResponseEntity.ok(views.view(id, year));
    }

    @PostMapping("/reports/{id}/cells")
    @RequiresPermission(form = "rpt.reports", action = "view")
    public ResponseEntity<CellRows> cells(@PathVariable long id, @RequestBody CellQuery query) {
        return ResponseEntity.ok(views.cells(id, query));
    }
}

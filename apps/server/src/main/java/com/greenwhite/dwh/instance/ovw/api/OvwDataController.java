package com.greenwhite.dwh.instance.ovw.api;

import com.greenwhite.dwh.instance.common.annotation.RequiresPermission;
import com.greenwhite.dwh.instance.ovw.OvwModel.GroupsQuery;
import com.greenwhite.dwh.instance.ovw.OvwModel.GroupsResult;
import com.greenwhite.dwh.instance.ovw.OvwModel.Layout;
import com.greenwhite.dwh.instance.ovw.OvwModel.RowsPage;
import com.greenwhite.dwh.instance.ovw.OvwModel.RowsQuery;
import com.greenwhite.dwh.instance.ovw.OvwModel.SourceItem;
import com.greenwhite.dwh.instance.ovw.service.OvwDataService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Обзор данных (И14): источники, раскладка, строки, группы; только чтение. */
@RestController
@RequestMapping("/api/v1/ovw")
public class OvwDataController {

    private final OvwDataService service;

    public OvwDataController(OvwDataService service) {
        this.service = service;
    }

    @GetMapping("/sources")
    @RequiresPermission(form = "ovw.data", action = "view")
    public ResponseEntity<List<SourceItem>> sources() {
        return ResponseEntity.ok(service.sources());
    }

    @GetMapping("/sources/{sourceId}/layout")
    @RequiresPermission(form = "ovw.data", action = "view")
    public ResponseEntity<Layout> layout(@PathVariable long sourceId,
                                         @RequestParam(required = false) Integer sheet) {
        return ResponseEntity.ok(service.layout(sourceId, sheet));
    }

    @PostMapping("/sources/{sourceId}/rows")
    @RequiresPermission(form = "ovw.data", action = "view")
    public ResponseEntity<RowsPage> rows(@PathVariable long sourceId, @RequestBody RowsQuery query) {
        return ResponseEntity.ok(service.rows(sourceId, query));
    }

    @PostMapping("/sources/{sourceId}/groups")
    @RequiresPermission(form = "ovw.data", action = "view")
    public ResponseEntity<GroupsResult> groups(@PathVariable long sourceId, @RequestBody GroupsQuery query) {
        return ResponseEntity.ok(service.groups(sourceId, query));
    }
}

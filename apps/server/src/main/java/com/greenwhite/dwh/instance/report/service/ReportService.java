package com.greenwhite.dwh.instance.report.service;

import com.greenwhite.dwh.instance.common.error.ApiException;
import com.greenwhite.dwh.instance.md.service.MdScopeService;
import com.greenwhite.dwh.instance.report.repository.ReportRepository;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

@Service
@Transactional(readOnly = true)
public class ReportService {

    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm")
            .withZone(ZoneId.of("UTC"));

    private final ReportRepository reportRepository;
    private final MdScopeService scopeService;
    private final int maxExportRows;

    @org.springframework.beans.factory.annotation.Autowired
    public ReportService(ReportRepository reportRepository, MdScopeService scopeService,
                         @org.springframework.beans.factory.annotation.Value("${dwh.reports.export.max-rows:50000}") int maxExportRows) {
        this.reportRepository = reportRepository;
        this.scopeService = scopeService;
        this.maxExportRows = maxExportRows > 0 ? maxExportRows : ReportRepository.DEFAULT_MAX_EXPORT_ROWS;
    }

    public ReportService(ReportRepository reportRepository, MdScopeService scopeService) {
        this(reportRepository, scopeService, ReportRepository.DEFAULT_MAX_EXPORT_ROWS);
    }

    public ReportService(JdbcClient jdbcClient, MdScopeService scopeService) {
        this(new ReportRepository(jdbcClient), scopeService, ReportRepository.DEFAULT_MAX_EXPORT_ROWS);
    }

    public void exportTasksCsv(OutputStream outputStream, Long currentUserId) throws IOException {
        if (currentUserId == null) {
            throw ApiException.unauthorized("Требуется авторизация для экспорта задач");
        }
        var scope = scopeService.filterForTasks(currentUserId);
        // UTF-8 BOM so Microsoft Excel automatically recognizes Russian UTF-8
        outputStream.write(new byte[]{(byte) 0xEF, (byte) 0xBB, (byte) 0xBF});

        java.io.BufferedWriter writer = new java.io.BufferedWriter(new OutputStreamWriter(outputStream, StandardCharsets.UTF_8));
        writer.write("ID;Заголовок;Проект;Приоритет;Статус;Срок;Дата создания;Автор\n");

        try {
            reportRepository.streamScopedTasks(scope, maxExportRows, row -> {
                try {
                    String title = escapeCsv(row.title());
                    String project = escapeCsv(row.projectName());
                    String priority = mapPriority(row.priority());
                    String status = escapeCsv(row.statusName());
                    String endTimeStr = row.endTime() != null ? DATE_FMT.format(row.endTime()) : "—";
                    String createdStr = row.createdAt() != null ? DATE_FMT.format(row.createdAt()) : "—";
                    String reporter = escapeCsv(row.reporterName());

                    writer.write(String.format("%d;%s;%s;%s;%s;%s;%s;%s%n",
                            row.id(), title, project, priority, status, endTimeStr, createdStr, reporter));
                } catch (IOException e) {
                    throw new ClientAbortException(e);
                }
            });
            writer.flush();
        } catch (ClientAbortException | IOException e) {
            // Client aborted or socket closed; terminate streaming and release DB connection cleanly
        }
    }

    public void exportTasksExcelXml(OutputStream outputStream, Long currentUserId) throws IOException {
        if (currentUserId == null) {
            throw ApiException.unauthorized("Требуется авторизация для экспорта задач");
        }
        var scope = scopeService.filterForTasks(currentUserId);
        java.io.BufferedWriter writer = new java.io.BufferedWriter(new OutputStreamWriter(outputStream, StandardCharsets.UTF_8));

        try {
            writer.write("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
            writer.write("<?mso-application progid=\"Excel.Sheet\"?>\n");
            writer.write("<Workbook xmlns=\"urn:schemas-microsoft-com:office:spreadsheet\"\n");
            writer.write(" xmlns:o=\"urn:schemas-microsoft-com:office:office\"\n");
            writer.write(" xmlns:x=\"urn:schemas-microsoft-com:office:excel\"\n");
            writer.write(" xmlns:ss=\"urn:schemas-microsoft-com:office:spreadsheet\"\n");
            writer.write(" xmlns:html=\"http://www.w3.org/TR/REC-html40\">\n");
            writer.write(" <Styles>\n");
            writer.write("  <Style ss:ID=\"Header\">\n");
            writer.write("   <Font ss:Bold=\"1\" ss:Color=\"#FFFFFF\"/>\n");
            writer.write("   <Interior ss:Color=\"#0284C7\" ss:Pattern=\"Solid\"/>\n");
            writer.write("   <Alignment ss:Horizontal=\"Center\" ss:Vertical=\"Center\"/>\n");
            writer.write("  </Style>\n");
            writer.write("  <Style ss:ID=\"Row\">\n");
            writer.write("   <Alignment ss:Vertical=\"Center\"/>\n");
            writer.write("  </Style>\n");
            writer.write(" </Styles>\n");
            writer.write(" <Worksheet ss:Name=\"Задачи\">\n");
            writer.write("  <Table>\n");
            writer.write("   <Column ss:Width=\"50\"/>\n");
            writer.write("   <Column ss:Width=\"220\"/>\n");
            writer.write("   <Column ss:Width=\"140\"/>\n");
            writer.write("   <Column ss:Width=\"90\"/>\n");
            writer.write("   <Column ss:Width=\"90\"/>\n");
            writer.write("   <Column ss:Width=\"110\"/>\n");
            writer.write("   <Column ss:Width=\"110\"/>\n");
            writer.write("   <Column ss:Width=\"130\"/>\n");

            // Header
            writer.write("   <Row ss:StyleID=\"Header\">\n");
            writer.write("    <Cell><Data ss:Type=\"String\">ID</Data></Cell>\n");
            writer.write("    <Cell><Data ss:Type=\"String\">Заголовок</Data></Cell>\n");
            writer.write("    <Cell><Data ss:Type=\"String\">Проект</Data></Cell>\n");
            writer.write("    <Cell><Data ss:Type=\"String\">Приоритет</Data></Cell>\n");
            writer.write("    <Cell><Data ss:Type=\"String\">Статус</Data></Cell>\n");
            writer.write("    <Cell><Data ss:Type=\"String\">Срок</Data></Cell>\n");
            writer.write("    <Cell><Data ss:Type=\"String\">Дата создания</Data></Cell>\n");
            writer.write("    <Cell><Data ss:Type=\"String\">Автор</Data></Cell>\n");
            writer.write("   </Row>\n");

            reportRepository.streamScopedTasks(scope, maxExportRows, row -> {
                try {
                    String title = escapeXml(row.title());
                    String project = escapeXml(row.projectName());
                    String priority = mapPriority(row.priority());
                    String status = escapeXml(row.statusName());
                    String endTimeStr = row.endTime() != null ? DATE_FMT.format(row.endTime()) : "—";
                    String createdStr = row.createdAt() != null ? DATE_FMT.format(row.createdAt()) : "—";
                    String reporter = escapeXml(row.reporterName());

                    writer.write("   <Row ss:StyleID=\"Row\">\n");
                    writer.write(String.format("    <Cell><Data ss:Type=\"Number\">%d</Data></Cell>%n", row.id()));
                    writer.write(String.format("    <Cell><Data ss:Type=\"String\">%s</Data></Cell>%n", title));
                    writer.write(String.format("    <Cell><Data ss:Type=\"String\">%s</Data></Cell>%n", project));
                    writer.write(String.format("    <Cell><Data ss:Type=\"String\">%s</Data></Cell>%n", priority));
                    writer.write(String.format("    <Cell><Data ss:Type=\"String\">%s</Data></Cell>%n", status));
                    writer.write(String.format("    <Cell><Data ss:Type=\"String\">%s</Data></Cell>%n", endTimeStr));
                    writer.write(String.format("    <Cell><Data ss:Type=\"String\">%s</Data></Cell>%n", createdStr));
                    writer.write(String.format("    <Cell><Data ss:Type=\"String\">%s</Data></Cell>%n", reporter));
                    writer.write("   </Row>\n");
                } catch (IOException e) {
                    throw new ClientAbortException(e);
                }
            });

            writer.write("  </Table>\n");
            writer.write(" </Worksheet>\n");
            writer.write("</Workbook>\n");
            writer.flush();
        } catch (ClientAbortException | IOException e) {
            // Client aborted or socket closed; terminate streaming and release DB connection cleanly
        }
    }

    private static final class ClientAbortException extends RuntimeException {
        ClientAbortException(IOException cause) {
            super(cause);
        }
    }

    private String escapeCsv(String value) {
        if (value == null) return "";
        boolean unsafePrefix = hasSpreadsheetPrefix(value);
        if (unsafePrefix) value = "'" + value;
        if (unsafePrefix || value.contains(";") || value.contains("\"") || value.contains("\n") || value.contains("\r")) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }

    private boolean hasSpreadsheetPrefix(String value) {
        // Inspect prefixes that importers may trim, but preserve the original text verbatim.
        // This protects initial CSV export, not later save/re-import transformations by spreadsheet clients.
        for (int offset = 0; offset < value.length();) {
            int ch = value.codePointAt(offset);
            if (ch == '=' || ch == '+' || ch == '-' || ch == '@'
                    || ch == '＝' || ch == '＋' || ch == '－' || ch == '＠'
                    || ch == '\t' || ch == '\r' || ch == '\n') {
                return true;
            }
            if (!Character.isWhitespace(ch) && !Character.isSpaceChar(ch)
                    && !Character.isISOControl(ch) && Character.getType(ch) != Character.FORMAT) {
                return false;
            }
            offset += Character.charCount(ch);
        }
        return false;
    }

    private String escapeXml(String value) {
        if (value == null) return "";
        return value.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }

    private String mapPriority(String p) {
        if (p == null) return "Средний";
        return switch (p.toLowerCase()) {
            case "critical" -> "Критический";
            case "high" -> "Высокий";
            case "low" -> "Низкий";
            default -> "Средний";
        };
    }
}

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

    @org.springframework.beans.factory.annotation.Autowired
    public ReportService(ReportRepository reportRepository, MdScopeService scopeService) {
        this.reportRepository = reportRepository;
        this.scopeService = scopeService;
    }

    public ReportService(JdbcClient jdbcClient, MdScopeService scopeService) {
        this(new ReportRepository(jdbcClient), scopeService);
    }

    public void exportTasksCsv(OutputStream outputStream, Long currentUserId) throws IOException {
        if (currentUserId == null) {
            throw ApiException.unauthorized("Требуется авторизация для экспорта задач");
        }
        var scope = scopeService.filterForTasks(currentUserId);
        // UTF-8 BOM so Microsoft Excel automatically recognizes Russian UTF-8
        outputStream.write(new byte[]{(byte) 0xEF, (byte) 0xBB, (byte) 0xBF});

        PrintWriter writer = new PrintWriter(new OutputStreamWriter(outputStream, StandardCharsets.UTF_8));
        writer.println("ID;Заголовок;Проект;Приоритет;Статус;Срок;Дата создания;Автор");

        reportRepository.streamScopedTasks(scope, row -> {
            String title = escapeCsv(row.title());
            String project = escapeCsv(row.projectName());
            String priority = mapPriority(row.priority());
            String status = escapeCsv(row.statusName());
            String endTimeStr = row.endTime() != null ? DATE_FMT.format(row.endTime()) : "—";
            String createdStr = row.createdAt() != null ? DATE_FMT.format(row.createdAt()) : "—";
            String reporter = escapeCsv(row.reporterName());

            writer.printf("%d;%s;%s;%s;%s;%s;%s;%s%n",
                    row.id(), title, project, priority, status, endTimeStr, createdStr, reporter);
        });

        writer.flush();
    }

    public void exportTasksExcelXml(OutputStream outputStream, Long currentUserId) throws IOException {
        if (currentUserId == null) {
            throw ApiException.unauthorized("Требуется авторизация для экспорта задач");
        }
        var scope = scopeService.filterForTasks(currentUserId);
        PrintWriter writer = new PrintWriter(new OutputStreamWriter(outputStream, StandardCharsets.UTF_8));

        writer.println("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
        writer.println("<?mso-application progid=\"Excel.Sheet\"?>");
        writer.println("<Workbook xmlns=\"urn:schemas-microsoft-com:office:spreadsheet\"");
        writer.println(" xmlns:o=\"urn:schemas-microsoft-com:office:office\"");
        writer.println(" xmlns:x=\"urn:schemas-microsoft-com:office:excel\"");
        writer.println(" xmlns:ss=\"urn:schemas-microsoft-com:office:spreadsheet\"");
        writer.println(" xmlns:html=\"http://www.w3.org/TR/REC-html40\">");
        writer.println(" <Styles>");
        writer.println("  <Style ss:ID=\"Header\">");
        writer.println("   <Font ss:Bold=\"1\" ss:Color=\"#FFFFFF\"/>");
        writer.println("   <Interior ss:Color=\"#0284C7\" ss:Pattern=\"Solid\"/>");
        writer.println("   <Alignment ss:Horizontal=\"Center\" ss:Vertical=\"Center\"/>");
        writer.println("  </Style>");
        writer.println("  <Style ss:ID=\"Row\">");
        writer.println("   <Alignment ss:Vertical=\"Center\"/>");
        writer.println("  </Style>");
        writer.println(" </Styles>");
        writer.println(" <Worksheet ss:Name=\"Задачи\">");
        writer.println("  <Table>");
        writer.println("   <Column ss:Width=\"50\"/>");
        writer.println("   <Column ss:Width=\"220\"/>");
        writer.println("   <Column ss:Width=\"140\"/>");
        writer.println("   <Column ss:Width=\"90\"/>");
        writer.println("   <Column ss:Width=\"90\"/>");
        writer.println("   <Column ss:Width=\"110\"/>");
        writer.println("   <Column ss:Width=\"110\"/>");
        writer.println("   <Column ss:Width=\"130\"/>");

        // Header
        writer.println("   <Row ss:StyleID=\"Header\">");
        writer.println("    <Cell><Data ss:Type=\"String\">ID</Data></Cell>");
        writer.println("    <Cell><Data ss:Type=\"String\">Заголовок</Data></Cell>");
        writer.println("    <Cell><Data ss:Type=\"String\">Проект</Data></Cell>");
        writer.println("    <Cell><Data ss:Type=\"String\">Приоритет</Data></Cell>");
        writer.println("    <Cell><Data ss:Type=\"String\">Статус</Data></Cell>");
        writer.println("    <Cell><Data ss:Type=\"String\">Срок</Data></Cell>");
        writer.println("    <Cell><Data ss:Type=\"String\">Дата создания</Data></Cell>");
        writer.println("    <Cell><Data ss:Type=\"String\">Автор</Data></Cell>");
        writer.println("   </Row>");

        reportRepository.streamScopedTasks(scope, row -> {
            String title = escapeXml(row.title());
            String project = escapeXml(row.projectName());
            String priority = mapPriority(row.priority());
            String status = escapeXml(row.statusName());
            String endTimeStr = row.endTime() != null ? DATE_FMT.format(row.endTime()) : "—";
            String createdStr = row.createdAt() != null ? DATE_FMT.format(row.createdAt()) : "—";
            String reporter = escapeXml(row.reporterName());

            writer.println("   <Row ss:StyleID=\"Row\">");
            writer.printf("    <Cell><Data ss:Type=\"Number\">%d</Data></Cell>%n", row.id());
            writer.printf("    <Cell><Data ss:Type=\"String\">%s</Data></Cell>%n", title);
            writer.printf("    <Cell><Data ss:Type=\"String\">%s</Data></Cell>%n", project);
            writer.printf("    <Cell><Data ss:Type=\"String\">%s</Data></Cell>%n", priority);
            writer.printf("    <Cell><Data ss:Type=\"String\">%s</Data></Cell>%n", status);
            writer.printf("    <Cell><Data ss:Type=\"String\">%s</Data></Cell>%n", endTimeStr);
            writer.printf("    <Cell><Data ss:Type=\"String\">%s</Data></Cell>%n", createdStr);
            writer.printf("    <Cell><Data ss:Type=\"String\">%s</Data></Cell>%n", reporter);
            writer.println("   </Row>");
        });

        writer.println("  </Table>");
        writer.println(" </Worksheet>");
        writer.println("</Workbook>");
        writer.flush();
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

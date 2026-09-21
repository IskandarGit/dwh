package com.greenwhite.dwh.instance.upl;

import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture.Format;
import com.greenwhite.dwh.instance.support.fixtures.DepartmentFixture.FormatColumn;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Column;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.DataType;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.FileKind;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.MatchBy;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Periodicity;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.Sheet;
import com.greenwhite.dwh.instance.upl.format.UplFormatModel.SourceData;
import com.greenwhite.dwh.instance.upl.format.UplSourceService;
import com.greenwhite.dwh.instance.upl.format.UplSourceService.DraftData;

import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

/** Анкета фикстуры как источник загрузки: общие данные тестов конфигурации экземпляра. */
public final class UplFixtureSources {

    /** Номер первой версии анкеты. */
    public static final int FIRST_VERSION = 1;

    private static final String SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
    private static final int SUFFIX_LENGTH = 6;

    private UplFixtureSources() {
    }

    /** Источник с опубликованной первой версией анкеты фикстуры; возвращает id источника. */
    public static long publish(UplSourceService service, Format format, long userId) {
        long id = service.createSource(sourceData(format), userId).source().id();
        service.createDraft(id, null, userId);
        int lock = service.getVersion(id, FIRST_VERSION).lockVersion();
        service.replaceDraft(id, FIRST_VERSION, lock, draftData(format), userId);
        service.publish(id, FIRST_VERSION, format.validFrom(), userId);
        return id;
    }

    public static SourceData sourceData(Format f) {
        return new SourceData(f.code() + "-" + randomSuffix(), f.name(), f.ownerOrg(), null,
                Periodicity.fromDb(f.periodicity()), f.slaDays(), null, null);
    }

    public static DraftData draftData(Format f) {
        List<Sheet> sheets = f.sheets().stream()
                .map(s -> new Sheet(null, 0, s.sheetName(), s.headerRow(), s.totalRowMarker(),
                        s.columns().stream().map(UplFixtureSources::column).toList()))
                .toList();
        return new DraftData(FileKind.fromDb(f.fileKind()), f.encoding(), f.delimiter(),
                MatchBy.fromDb(f.matchColumnsBy()), sheets);
    }

    private static Column column(FormatColumn c) {
        return new Column(null, 0, c.filePosition(), c.name(), c.field(), DataType.fromDb(c.type()), c.required(),
                c.sourceUnit(), c.baseUnit(), c.keyMask(), c.keyPadLength(), c.keyPadMax(), c.refBook());
    }

    private static String randomSuffix() {
        StringBuilder suffix = new StringBuilder(SUFFIX_LENGTH);
        for (int i = 0; i < SUFFIX_LENGTH; i++) {
            suffix.append(SUFFIX_ALPHABET.charAt(ThreadLocalRandom.current().nextInt(SUFFIX_ALPHABET.length())));
        }
        return suffix.toString();
    }
}

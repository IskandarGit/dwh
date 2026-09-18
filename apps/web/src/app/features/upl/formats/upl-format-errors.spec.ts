import { describe, expect, it } from 'vitest';
import { ProblemDetail } from '../../../core/models/common.models';
import { parseUplFieldErrors, parseUplProblem, uplCellError, uplFieldErrorText, uplSheetError, uplSheetHasErrors } from './upl-format-errors';

function problem(extra: Partial<ProblemDetail>): ProblemDetail {
  return { title: 'Ошибка', status: 422, code: 'validation_failed', detail: 'UPL_FORMAT_INVALID', ...extra };
}

describe('upl format field errors', () => {
  it('reads sheet and column indexes of a column address', () => {
    const [error] = parseUplFieldErrors([{ field: 'sheets[0].columns[2].keyMask', code: 'UPL_KEY_MASK_REQUIRED', message: 'нужна маска' }]);

    expect(error).toMatchObject({ sheet: 0, column: 2, field: 'keyMask', code: 'UPL_KEY_MASK_REQUIRED', message: 'нужна маска' });
    expect(error.key).toBe('upl.err.UPL_KEY_MASK_REQUIRED');
  });

  it('keeps a sheet level address without a column', () => {
    const [error] = parseUplFieldErrors([{ field: 'sheets[1].sheetName', code: 'UPL_SHEET_NAME_REQUIRED', message: 'x' }]);

    expect(error).toMatchObject({ sheet: 1, column: null, field: 'sheetName' });
  });

  it('gives an empty field for an address of the sheet itself', () => {
    const [error] = parseUplFieldErrors([{ field: 'sheets[1]', code: 'UPL_SHEET_INVALID', message: 'x' }]);

    expect(error).toMatchObject({ sheet: 1, column: null, field: '' });
  });

  it('leaves an address it does not recognize as is', () => {
    const list = parseUplFieldErrors([
      { field: 'sheets', code: 'UPL_SHEETS_REQUIRED', message: 'x' },
      { field: 'fileKind', code: 'UPL_FILE_KIND_INVALID', message: 'y' }
    ]);

    expect(list[0]).toMatchObject({ sheet: null, column: null, field: 'sheets' });
    expect(list[1]).toMatchObject({ sheet: null, column: null, field: 'fileKind' });
  });

  it('returns an empty list for a missing errors array', () => {
    expect(parseUplFieldErrors(null)).toEqual([]);
    expect(parseUplFieldErrors(undefined)).toEqual([]);
  });

  it('merges errors and invalid_params, drops duplicates and fills an empty code', () => {
    const list = parseUplProblem(problem({
      errors: [{ field: 'sheets[0].columns[1].sourceUnit', code: 'UPL_UNIT_UNKNOWN', message: 'нет единицы' }],
      invalid_params: [
        { name: 'sheets[0].columns[1].sourceUnit', code: 'UPL_UNIT_UNKNOWN', reason: 'нет единицы' },
        { name: 'sheets[0].headerRow', reason: 'строка заголовка' }
      ]
    }));

    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ sheet: 0, column: 1, field: 'sourceUnit', code: 'UPL_UNIT_UNKNOWN' });
    expect(list[1]).toMatchObject({ sheet: 0, column: null, field: 'headerRow', code: 'VALIDATION_FAILED', key: 'upl.err.VALIDATION_FAILED', message: 'строка заголовка' });
  });

  it('finds a cell error only at its own address', () => {
    const list = parseUplFieldErrors([{ field: 'sheets[0].columns[1].keyMask', code: 'UPL_KEY_MASK_REQUIRED', message: 'x' }]);

    expect(uplCellError(list, 0, 1, 'keyMask')).toMatchObject({ code: 'UPL_KEY_MASK_REQUIRED' });
    expect(uplCellError(list, 0, 0, 'keyMask')).toBeNull();
    expect(uplCellError(list, 0, 1, 'targetField')).toBeNull();
    expect(uplSheetError(list, 0, 'keyMask')).toBeNull();
  });

  it('marks only sheets that have errors', () => {
    const list = parseUplFieldErrors([
      { field: 'sheets[1].columns[0].nameInFile', code: 'UPL_COLUMN_NAME_REQUIRED', message: 'x' },
      { field: 'sheets[1].headerRow', code: 'UPL_HEADER_ROW_INVALID', message: 'y' }
    ]);

    expect(uplSheetHasErrors(list, 1)).toBe(true);
    expect(uplSheetHasErrors(list, 0)).toBe(false);
    expect(uplSheetError(list, 1, 'headerRow')).toMatchObject({ code: 'UPL_HEADER_ROW_INVALID' });
  });
});

describe('uplFieldErrorText', () => {
  function fieldError(code: string, message: string) {
    return parseUplFieldErrors([{ field: 'name', code, message }])[0];
  }

  it('берёт перевод, когда ключ есть в словаре', () => {
    const error = fieldError('UPL_KNOWN', 'x');

    expect(uplFieldErrorText(error, () => 'Понятный текст')).toBe('Понятный текст');
  });

  it('без перевода показывает сообщение сервера и код в скобках', () => {
    const error = fieldError('UPL_NEW', 'x');

    expect(uplFieldErrorText(error, key => key)).toBe('x (UPL_NEW)');
  });

  it('без перевода и без сообщения показывает код дважды, но не сырой ключ', () => {
    const error = fieldError('UPL_NEW', '');

    expect(uplFieldErrorText(error, key => key)).toBe('UPL_NEW (UPL_NEW)');
  });
});

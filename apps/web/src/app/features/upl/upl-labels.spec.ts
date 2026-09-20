import { describe, expect, it } from 'vitest';
import { ProblemDetail } from '../../core/models/common.models';
import { uplProblemText } from './upl-labels';

const translate = (key: string): string => (key === 'upl.err.UPL_NO_SHEETS' ? 'TEST-TEXT' : key);

function problem(detail: string, code: string): ProblemDetail {
  return { title: 'TEST', status: 422, code, detail };
}

describe('uplProblemText', () => {
  it('translates a known error subcode', () => {
    expect(uplProblemText(problem('UPL_NO_SHEETS', 'VALIDATION_FAILED'), translate)).toBe('TEST-TEXT');
  });

  it('shows subcode and framework code when the subcode is unknown', () => {
    expect(uplProblemText(problem('X_CODE', 'VALIDATION_FAILED'), translate)).toBe('X_CODE (VALIDATION_FAILED)');
  });

  it('does not fail without a problem', () => {
    expect(uplProblemText(undefined, translate)).toBe(' ()');
  });
});

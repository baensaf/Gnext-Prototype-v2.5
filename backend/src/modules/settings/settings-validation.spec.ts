import { BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';

// `validateGroupSettingValue` is pure: it reads no repository and writes no
// audit, so the service can be constructed without its injected dependencies.
const service = new SettingsService(null as any, null as any, null as any, null as any, null as any);
const validate = (value: Record<string, any>) => () =>
  service.validateGroupSettingValue('ORDER_ACTIONS', value);

describe('ORDER_ACTIONS setting validation', () => {
  it('accepts the seeded defaults', () => {
    expect(validate({ editWindowMinutes: 10, cancelWindowMinutes: 10 })).not.toThrow();
  });

  it('accepts zero, meaning every action escalates to a manager', () => {
    expect(validate({ editWindowMinutes: 0, cancelWindowMinutes: 0 })).not.toThrow();
  });

  it('accepts a partial update of a single window', () => {
    expect(validate({ cancelWindowMinutes: 30 })).not.toThrow();
  });

  it('rejects negative, fractional and non-numeric windows', () => {
    expect(validate({ editWindowMinutes: -1 })).toThrow(BadRequestException);
    expect(validate({ editWindowMinutes: 2.5 })).toThrow(BadRequestException);
    expect(validate({ cancelWindowMinutes: 'ten' })).toThrow(BadRequestException);
  });

  it('names the offending property so the settings UI can point at the field', () => {
    expect(validate({ cancelWindowMinutes: -1 })).toThrow(/cancelWindowMinutes/);
  });

  it('still rejects a non-object group value', () => {
    expect(() => service.validateGroupSettingValue('ORDER_ACTIONS', null as any)).toThrow(
      BadRequestException,
    );
  });
});

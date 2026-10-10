import { courierDeliveryFee } from '../src/modules/delivery/delivery-fee';

describe('A delivery price typed at the register and the courier', () => {
  it('pays the zone fee when no price was typed', () => {
    expect(courierDeliveryFee('30000.0000', null)).toBe('30000.0000');
    expect(courierDeliveryFee('30000.0000', undefined)).toBe('30000.0000');
  });

  it('pays the typed price when it is more than the zone fee', () => {
    expect(courierDeliveryFee('30000.0000', '50000.0000')).toBe('50000.0000');
  });

  it('keeps the zone fee when the typed price is lower or free', () => {
    expect(courierDeliveryFee('30000.0000', '10000.0000')).toBe('30000.0000');
    expect(courierDeliveryFee('30000.0000', '0')).toBe('30000.0000');
  });

  it('has nothing to pay from a zone with no fee and no typed price', () => {
    expect(courierDeliveryFee(null, null)).toBe('0.0000');
  });
});

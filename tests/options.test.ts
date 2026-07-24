import 'reflect-metadata';
import { Expose } from '../src/decorators';
import { plainToInstance, instanceToPlain } from '../src/runtime';

class OptionsDto {
  @Expose()
  role: string = 'user';

  @Expose()
  status?: string;
}

class CircularSelf {
  @Expose()
  name!: string;

  @Expose()
  @Type(() => CircularSelf)
  self!: CircularSelf;
}

// Dummy decorator mock for type function mapping in local test scope
function Type(typeFn: () => any) {
  return (target: any, key: string) => {
    const { defaultMetadataStorage } = require('../src/metadata');
    const prop = defaultMetadataStorage.getOrCreateProp(target, key);
    prop.typeFn = typeFn;
  };
}

describe('Fast Class Transformer Advanced Option Compliance', () => {
  it('should keep default values when exposeDefaultValues is true', () => {
    const payload = {};
    const instance = plainToInstance(OptionsDto, payload, { exposeDefaultValues: true });
    expect(instance.role).toBe('user');
  });

  it('should overwrite default values with undefined when exposeDefaultValues is false', () => {
    const payload = {};
    const instance = plainToInstance(OptionsDto, payload, { exposeDefaultValues: false });
    expect(instance.role).toBeUndefined();
  });

  it('should include keys as undefined when exposeUnsetFields is true', () => {
    const payload = {};
    const instance = plainToInstance(OptionsDto, payload, { exposeUnsetFields: true });
    expect(Object.keys(instance)).toContain('status');
  });

  it('should exclude keys from instance when exposeUnsetFields is false', () => {
    const payload = {};
    const instance = plainToInstance(OptionsDto, payload, { exposeUnsetFields: false, exposeDefaultValues: false });
    expect(Object.keys(instance)).not.toContain('status');
    expect(Object.keys(instance)).not.toContain('role');
  });

  it('should terminate circular references without stack overflow when enableCircularCheck is true', () => {
    const payload: any = { name: 'Infinite' };
    payload.self = payload; // circular self-loop

    const instance = plainToInstance(CircularSelf, payload, { enableCircularCheck: true });
    expect(instance).toBeInstanceOf(CircularSelf);
    expect(instance.name).toBe('Infinite');
    expect(instance.self).toBeUndefined(); // Terminated circular loop
  });
});

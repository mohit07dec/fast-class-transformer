import 'reflect-metadata';
import { Expose, Exclude, Type, Transform } from '../src/decorators';
import { plainToInstance, instanceToPlain, instanceToInstance } from '../src/runtime';

class Profile {
  @Expose()
  bio!: string;

  @Expose()
  avatar!: string;
}

class User {
  @Expose()
  id!: number;

  @Expose({ name: 'full_name' })
  fullName!: string;

  @Exclude()
  password!: string;

  @Expose()
  @Type(() => Profile)
  profile!: Profile;

  @Expose()
  createdAt!: Date;

  @Expose()
  @Transform(({ value }) => value.toUpperCase())
  role!: string;
}

describe('Fast Class Transformer JIT Core', () => {
  it('should map plain object to class instance correctly', () => {
    const raw = {
      id: 42,
      full_name: 'John Doe',
      password: 'secret_password',
      profile: {
        bio: 'Software Developer',
        avatar: 'avatar.png'
      },
      createdAt: '2026-07-23T20:00:00.000Z',
      role: 'admin',
      extra_prop: 'should_be_ignored_if_not_exposed'
    };

    const user = plainToInstance(User, raw);

    expect(user).toBeInstanceOf(User);
    expect(user.id).toBe(42);
    expect(user.fullName).toBe('John Doe');
    expect(user.password).toBeUndefined(); // Excluded
    expect(user.profile).toBeInstanceOf(Profile);
    expect(user.profile.bio).toBe('Software Developer');
    expect(user.profile.avatar).toBe('avatar.png');
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.createdAt.toISOString()).toBe('2026-07-23T20:00:00.000Z');
    expect(user.role).toBe('ADMIN'); // Upper-cased by Transform decorator
    expect((user as any).extra_prop).toBeUndefined(); // Sanitized by lack of decorator (since it has decorators on other properties)
  });

  it('should serialize class instance back to plain object', () => {
    const user = new User();
    user.id = 101;
    user.fullName = 'Jane Doe';
    user.password = 'super_secret';
    user.role = 'user';
    user.createdAt = new Date('2026-07-23T21:00:00.000Z');
    
    const profile = new Profile();
    profile.bio = 'Designer';
    profile.avatar = 'jane.png';
    user.profile = profile;

    const plain = instanceToPlain(user);

    expect(plain.id).toBe(101);
    expect(plain.full_name).toBe('Jane Doe'); // Mapped back to custom expose name
    expect(plain.password).toBeUndefined(); // Excluded
    expect(plain.profile).toEqual({
      bio: 'Designer',
      avatar: 'jane.png'
    });
    expect(plain.createdAt).toBe('2026-07-23T21:00:00.000Z');
    expect(plain.role).toBe('USER');
  });

  it('should clone instance with instanceToInstance', () => {
    const user = new User();
    user.id = 202;
    user.fullName = 'Bob';
    user.password = 'pass';
    user.role = 'editor';
    user.createdAt = new Date('2026-07-23T22:00:00.000Z');

    const clone = instanceToInstance(user);

    expect(clone).toBeInstanceOf(User);
    expect(clone.id).toBe(202);
    expect(clone.fullName).toBe('Bob');
    expect(clone.password).toBeUndefined(); // Excluded during serialization/deserialization
    expect(clone.createdAt).toBeInstanceOf(Date);
    expect(clone.createdAt.getTime()).toBe(user.createdAt.getTime());
  });

  it('should handle array transformations', () => {
    const rawArray = [
      { id: 1, full_name: 'User 1', role: 'admin' },
      { id: 2, full_name: 'User 2', role: 'user' }
    ];

    const instances = plainToInstance(User, rawArray);

    expect(instances).toBeInstanceOf(Array);
    expect(instances.length).toBe(2);
    expect(instances[0]).toBeInstanceOf(User);
    expect(instances[0].id).toBe(1);
    expect(instances[0].fullName).toBe('User 1');
    expect(instances[1].fullName).toBe('User 2');
  });
});

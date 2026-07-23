import 'reflect-metadata';
import { IsString, IsInt, Min, Max, IsEmail } from 'class-validator';
import { Expose, Type } from '../src/decorators';
import { plainToInstance, FastValidationError } from '../src/runtime';

class ValidatedUser {
  @Expose()
  @IsString()
  username!: string;

  @Expose()
  @IsInt()
  @Min(18)
  @Max(99)
  age!: number;

  @Expose()
  @IsEmail()
  email!: string;
}

// Circular Reference Classes
class CircularUser {
  @Expose()
  name!: string;

  @Expose()
  @Type(() => CircularPost)
  posts!: CircularPost[];
}

class CircularPost {
  @Expose()
  title!: string;

  @Expose()
  @Type(() => CircularUser)
  author!: CircularUser;
}

describe('Fast Class Transformer Enterprise Operations', () => {
  describe('Single-Pass Validation', () => {
    it('should pass validation when payload is correct', () => {
      const payload = {
        username: 'john_doe',
        age: 25,
        email: 'john@example.com'
      };

      const user = plainToInstance(ValidatedUser, payload, { validate: true });
      expect(user).toBeInstanceOf(ValidatedUser);
      expect(user.username).toBe('john_doe');
      expect(user.age).toBe(25);
      expect(user.email).toBe('john@example.com');
    });

    it('should throw validation errors when payload is incorrect', () => {
      const payload = {
        username: 123, // Invalid string
        age: 15, // Less than min 18
        email: 'invalid-email' // Invalid email
      };

      expect(() => {
        plainToInstance(ValidatedUser, payload as any, { validate: true });
      }).toThrow(FastValidationError);

      try {
        plainToInstance(ValidatedUser, payload as any, { validate: true });
      } catch (err: any) {
        expect(err.isValidationError).toBe(true);
        expect(err.errors).toBeInstanceOf(Array);
        expect(err.errors.length).toBe(3);

        const errorMap = new Map(err.errors.map((e: any) => [e.property, e.constraints]));
        expect(errorMap.has('username')).toBe(true);
        expect(errorMap.has('age')).toBe(true);
        expect(errorMap.has('email')).toBe(true);
      }
    });

    it('should skip validation when validate option is false', () => {
      const payload = {
        username: 123,
        age: 15,
        email: 'invalid-email'
      };

      // Should not throw, should map it raw
      const user = plainToInstance(ValidatedUser, payload as any, { validate: false });
      expect(user.username).toBe(123);
      expect(user.age).toBe(15);
    });
  });

  describe('Circular Dependencies', () => {
    it('should handle circular structures lazily without crashing', () => {
      const raw = {
        name: 'John',
        posts: [
          {
            title: 'Post 1',
            author: { name: 'John' }
          }
        ]
      };

      const user = plainToInstance(CircularUser, raw);
      expect(user).toBeInstanceOf(CircularUser);
      expect(user.name).toBe('John');
      expect(user.posts[0]).toBeInstanceOf(CircularPost);
      expect(user.posts[0].title).toBe('Post 1');
      expect(user.posts[0].author).toBeInstanceOf(CircularUser);
      expect(user.posts[0].author.name).toBe('John');
    });
  });
});

import { describe, it, expectTypeOf } from 'vitest';
import { Type } from '@mikro-orm/core';
import type { InferJSType, ApplyOverrides } from '../src/types.js';

// --- Mock custom types ---

class TestStringType extends Type<string, string> {
  convertToDatabaseValue(value: string) { return value; }
  convertToJSValue(value: string) { return value; }
  getColumnType() { return 'text'; }
}

class TestRecordType extends Type<Record<string, unknown>, string> {
  convertToDatabaseValue(value: Record<string, unknown>) { return JSON.stringify(value); }
  convertToJSValue(value: string) { return JSON.parse(value) as Record<string, unknown>; }
  getColumnType() { return 'text'; }
}

interface BankInfo {
  bankName: string;
  accountNumber: string;
}

class TestBankInfoType extends Type<BankInfo, string> {
  convertToDatabaseValue(value: BankInfo) { return JSON.stringify(value); }
  convertToJSValue(value: string) { return JSON.parse(value) as BankInfo; }
  getColumnType() { return 'text'; }
}

// --- Mock entity ---

class MockEntity {
  idx!: number;
  code!: string;
  refundData: unknown = null;
  payBankInfo: string | null = null;
  isGift!: boolean;
}

// --- Tests ---

describe('InferJSType', () => {
  it('extracts JSType from Type<JSType, DBType>', () => {
    expectTypeOf<InferJSType<TestStringType>>().toEqualTypeOf<string>();
    expectTypeOf<InferJSType<TestRecordType>>().toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<InferJSType<TestBankInfoType>>().toEqualTypeOf<BankInfo>();
  });
});

describe('ApplyOverrides', () => {
  type Overrides = {
    refundData: TestRecordType;
    payBankInfo: TestBankInfoType;
  };

  type Result = ApplyOverrides<MockEntity, Overrides>;

  it('overrides a non-nullable property type', () => {
    // refundData was `unknown` (which includes null), so null extends unknown => true
    // The override should produce Record<string, unknown> | null
    expectTypeOf<Result['refundData']>().toEqualTypeOf<Record<string, unknown> | null>();
  });

  it('overrides a nullable property and preserves | null', () => {
    // payBankInfo was string | null, override should be BankInfo | null
    expectTypeOf<Result['payBankInfo']>().toEqualTypeOf<BankInfo | null>();
  });

  it('does not change non-overridden properties', () => {
    expectTypeOf<Result['idx']>().toEqualTypeOf<number>();
    expectTypeOf<Result['code']>().toEqualTypeOf<string>();
    expectTypeOf<Result['isGift']>().toEqualTypeOf<boolean>();
  });

  it('non-nullable property stays non-nullable after override', () => {
    // Override a non-nullable property (code: string) with TestStringType
    type OverrideCode = { code: TestStringType };
    type Result2 = ApplyOverrides<MockEntity, OverrideCode>;
    expectTypeOf<Result2['code']>().toEqualTypeOf<string>();
    // Confirm null is not part of the result
    expectTypeOf<Result2['code']>().not.toEqualTypeOf<string | null>();
  });

  it('works with MikroORM Type subclass', () => {
    type OverrideSingle = { refundData: TestRecordType };
    type Result3 = ApplyOverrides<MockEntity, OverrideSingle>;
    expectTypeOf<Result3['refundData']>().toEqualTypeOf<Record<string, unknown> | null>();
  });
});

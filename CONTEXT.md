# mikro-mapped-types — 구현 컨텍스트 문서

## 1. 프로젝트 목적

MikroORM v7 용 `OverrideType` 유틸리티 라이브러리.

자동 생성된 entity 클래스의 특정 프로퍼티 타입을 **application 레벨에서 커스텀 타입으로 오버라이드**할 수 있게 한다. TypeScript 타입과 MikroORM 런타임 메타데이터를 **동시에** 변환한다.

### 해결하려는 문제

`@imwebme/mikro-models` 패키지는 MySQL 스키마에서 MikroORM entity를 자동 생성한다. 일부 컬럼은 PHP `serialize()` 형식의 문자열을 저장하지만, generator는 이를 `string` 또는 `unknown`으로 생성한다.

Application에서는 이런 컬럼을 `PhpSerializedType<Record<string, unknown>>` 같은 커스텀 타입으로 변환하고 싶지만:

- **컬럼이 너무 많아서** generator 시점에 미리 파악 불가
- **구현 팀이 유연하게** 필요한 컬럼만 선택적으로 오버라이드하고 싶음
- Entity 상속 + `declare`로 프로퍼티 재정의하면 **TS 타입 불일치** 발생
- Entity 상속으로 새 클래스를 만들면 **같은 테이블에 두 entity가 매핑**되어 MikroORM 충돌

### 목표 API

```ts
import { OverrideType } from '@esnark/mikro-mapped-types';
import { ShopOrder } from '@imwebme/mikro-models/doznut_shop';
import { PhpSerializedType } from './types/php-serialized-type.js';

// refundData: unknown → Record<string, unknown>
// payBankInfo: string | null → BankInfo | null
@Entity({ tableName: 'shop_order', schema: 'doznut_shop' })
class AppShopOrder extends OverrideType(ShopOrder, {
  refundData: new PhpSerializedType<Record<string, unknown>>(),
  payBankInfo: new PhpSerializedType<BankInfo>(),
}) {}

const order = await em.findOne(AppShopOrder, { idx: 1 });
order.refundData; // Record<string, unknown>  (not unknown)
order.payBankInfo; // BankInfo | null          (not string | null)
order.code;        // string                   (unchanged, 상속)
```

---

## 2. 참조 구현: typeorm-mapped-types

GitHub: https://github.com/ESnark/typeorm-mapped-types

TypeORM 용으로 동일한 패턴을 구현한 라이브러리. 아키텍처를 참고한다.

### 핵심 원리

**두 개의 평면에서 동시에 작동:**

| 레벨 | 메커니즘 |
|------|----------|
| TypeScript 타입 | `Pick<T, K>`, `Omit<T, K>` + `MappedType<T>` 캐스팅 |
| 런타임 메타데이터 | TypeORM `MetadataArgsStorage` 글로벌 싱글턴의 엔트리를 clone + `target` 교체 |

### 소스 구조 (6 파일)

```
src/
├── index.ts                 # barrel export
├── interface.ts             # Type<T>, MappedType<T> 인터페이스
├── types.ts                 # RemoveFieldsWithType 유틸리티 타입
├── type-helpers.utils.ts    # inheritTypeOrmMetadata (핵심 런타임 로직)
├── pick-type.helper.ts      # PickType()
└── omit-type.helper.ts      # OmitType()
```

### 핵심 코드: inheritTypeOrmMetadata

```ts
// TypeORM은 글로벌 MetadataArgsStorage에 flat array로 메타데이터 저장
// 각 엔트리의 target을 새 클래스로 교체하여 복제

export function inheritTypeOrmMetadata(
  parentClass: Type<any>,
  targetClass: Function,
  isPropertyInherited: (propertyKey: string) => boolean,
) {
  const metadataArgsStorage = typeorm.getMetadataArgsStorage();

  // tables 복제
  const targetEntity = metadataArgsStorage.tables.find(
    (table) => table.target === parentClass,
  );
  if (targetEntity) {
    metadataArgsStorage.tables.push({ ...targetEntity, target: targetClass });
  }

  // columns 복제 (predicate로 필터링)
  const targetColumns = metadataArgsStorage.columns.filter(
    (column) => column.target === parentClass && isPropertyInherited(column.propertyName),
  );
  metadataArgsStorage.columns.push(
    ...targetColumns.map((column) => ({ ...column, target: targetClass })),
  );

  // relations, indices, uniques, checks, exclusions, embeddeds, entityListeners도 동일 패턴
}
```

### TypeScript 트릭

```ts
// 1. MappedType — 런타임 클래스를 생성 가능한 타입으로 캐스팅
export interface MappedType<T> extends Type<T> {
  new (): T;
}

// 2. abstract class를 만들어서 MappedType으로 캐스팅
abstract class PickClassType {
  constructor() {
    inheritPropertyInitializers(this, classRef, isInheritedPredicate);
  }
}
return PickClassType as MappedType<Pick<T, K>>;

// 3. readonly K[] + as const → 리터럴 유니온 추론
PickType(UserModel, ['id', 'email'] as const)
// K = 'id' | 'email' (not string)
```

---

## 3. MikroORM v7 메타데이터 시스템

TypeORM과 구조가 다르다. 이 차이를 이해해야 올바르게 구현할 수 있다.

### 3.1 메타데이터 저장 구조

```
TypeORM:  글로벌 싱글턴 MetadataArgsStorage → flat arrays (tables[], columns[], ...)
MikroORM: 글로벌 싱글턴 MetadataStorage     → Dictionary<EntityMetadata> (entity별 객체)
```

**MikroORM MetadataStorage (packages/core/src/metadata/MetadataStorage.ts):**

```ts
// 1단계: 데코레이터 시점 — 정적 딕셔너리 (globalThis['mikro-orm-metadata'])
static readonly #metadata: Dictionary<EntityMetadata> = getGlobalStorage('metadata');

static getMetadata<T>(entity: string, path: string): EntityMetadata<T> {
  const key = entity + '-' + Utils.hash(path);
  if (!MetadataStorage.#metadata[key]) {
    MetadataStorage.#metadata[key] = new EntityMetadata({ className: entity, path });
  }
  return MetadataStorage.#metadata[key];
}

// 2단계: 런타임 (discovery 이후) — instance Map
set<T>(entityName: EntityName<T>, meta: EntityMetadata): EntityMetadata {
  this.#metadataMap.set(entityName, meta);
  this.#idMap[meta._id] = meta;
  this.#uniqueNameMap[meta.uniqueName] = meta;
  this.#classNameMap[Utils.className(entityName)] = meta;
  return meta;
}
```

### 3.2 ES Decorators 메타데이터 흐름

`@imwebme/mikro-models`는 ES decorators (`decorators: 'es'`)를 사용한다.

```ts
// @Property() — context.metadata에 직접 쓴다
function Property<T>(options = {}) {
  return function (value, context: ClassFieldDecoratorContext<T>) {
    const meta = context.metadata as unknown as EntityMetadata<T>;
    // meta.properties[prop.name]에 프로퍼티 정보 기록
  };
}

// @Entity() — context.metadata를 읽어서 글로벌 MetadataStorage에 병합
function Entity(options = {}) {
  return function (target, context: ClassDecoratorContext) {
    const meta = getMetadataFromDecorator(target);
    const metadata = { ...context.metadata };
    Utils.mergeConfig(meta, metadata, options);
    meta.class = target;
  };
}
```

**`getMetadataFromDecorator`** — 글로벌 정적 저장소 접근:

```ts
function getMetadataFromDecorator<T>(target: T & Dictionary): EntityMetadata<T> {
  if (!Object.hasOwn(target, MetadataStorage.PATH_SYMBOL)) {
    Object.defineProperty(target, MetadataStorage.PATH_SYMBOL, {
      value: lookupPathFromDecorator(target.name),
      writable: true,
    });
  }
  return MetadataStorage.getMetadata(target.name, target[MetadataStorage.PATH_SYMBOL]!);
}
```

### 3.3 EntityMetadata 주요 필드

```ts
class EntityMetadata {
  className: string;
  name: string;
  class: Constructor;
  tableName: string;      // = collection
  schema?: string;
  abstract?: boolean;
  
  properties: Record<string, EntityProperty>;  // ← 핵심
  props: EntityProperty[];       // properties에서 파생 (sync() 호출 시)
  primaryKeys: string[];
  relations: EntityProperty[];
  indexes: { properties: string[] }[];
  uniques: { properties: string[] }[];
  
  _id: number;            // 내부 캐시 키
  
  sync(): void;           // properties → props, relations 등 파생 배열 재계산
}
```

### 3.4 EntityProperty 주요 필드

```ts
interface EntityProperty {
  name: string;             // JS 프로퍼티명
  type: string;             // 타입 이름 ('string', 'integer', 'BooleanType' 등)
  runtimeType: string;      // JS 런타임 타입 ('string', 'boolean', 'number' 등)
  customType?: Type<any>;   // ← 커스텀 타입 인스턴스 (이걸 오버라이드해야 함)
  columnTypes: string[];    // SQL 컬럼 타입 ('varchar(255)', 'text' 등)
  fieldNames: string[];     // DB 컬럼명
  kind: ReferenceKind;      // SCALAR, MANY_TO_ONE 등
  nullable?: boolean;
  primary?: boolean;
  enum?: boolean;
  items?: string[];         // enum values
  default?: any;
}
```

### 3.5 Type<JSType, DBType> 기본 클래스

```ts
abstract class Type<JSType = string, DBType = JSType> {
  platform?: Platform;
  meta?: EntityMetadata;
  prop?: EntityProperty;

  convertToDatabaseValue(value: JSType, platform: Platform): DBType;
  convertToJSValue(value: DBType, platform: Platform): JSType;

  // SQL 레벨 변환 (선택)
  convertToDatabaseValueSQL?(key: string, platform: Platform): string;
  convertToJSValueSQL?(key: string, platform: Platform): string;

  compareAsType(): string;   // 비교 전략
  get runtimeType(): string; // compareAsType() 기반
  getColumnType(prop: EntityProperty, platform: Platform): string;

  // 싱글턴 레지스트리
  static getType<T>(cls: TypeClass): InstanceType<TypeClass>;

  // 브랜드 마커 (prototype에 정의)
  __mappedType: true;  // Type.isMappedType(data)로 확인
}
```

### 3.6 Discovery 시 customType 처리

`MetadataDiscovery.initCustomType()` 에서:

1. `prop.type`이 `Type` 인스턴스면 → `prop.customType = prop.type`
2. `prop.type`이 `Type` 클래스(생성자)면 → `prop.customType = new (prop.type)()`
3. `customType`에 `platform`, `meta`, `prop` 역참조 설정
4. `columnTypes`를 `customType.getColumnType()`에서 파생
5. `runtimeType`를 `customType.runtimeType`에서 파생

---

## 4. 구현 설계

### 4.1 제공할 API

```ts
// OverrideType — 특정 프로퍼티의 customType을 교체
export function OverrideType<T, O extends OverrideMap>(
  parentClass: new () => T,
  overrides: O,
): new () => ApplyOverrides<T, O>;
```

추가로 `PickType`, `OmitType`도 제공하면 좋지만, **MVP는 `OverrideType` 하나**.

### 4.2 TypeScript 타입 레벨

```ts
import { Type } from '@mikro-orm/core';

// MikroORM Type<JSType, DBType>에서 JSType 추출
type InferJSType<T> = T extends Type<infer JS, any> ? JS : never;

// override 맵: { propertyName: Type 인스턴스 }
type OverrideMap = Record<string, Type<any, any>>;

// 원본 entity 타입에서 override 대상 프로퍼티만 타입 교체
// nullable 보존: 원래 T | null이면 Override 후에도 NewType | null
type ApplyOverrides<Entity, Overrides extends OverrideMap> = {
  [K in keyof Entity]: K extends keyof Overrides
    ? Entity[K] extends null  // null 포함 여부 체크
      ? InferJSType<Overrides[K]> | null
      : InferJSType<Overrides[K]>
    : Entity[K];
};
```

**주의**: nullable 프로퍼티 처리가 핵심이다. 생성된 entity에서 `refundData: unknown = null` (nullable)이면 override 후에도 `Record<string, unknown> | null`이어야 한다.

더 정확한 nullable 감지:

```ts
type ApplyOverrides<Entity, Overrides extends OverrideMap> = {
  [K in keyof Entity]: K extends keyof Overrides
    ? null extends Entity[K]
      ? InferJSType<Overrides[K]> | null
      : InferJSType<Overrides[K]>
    : Entity[K];
};
```

### 4.3 런타임 메타데이터 레벨

TypeORM과 달리, MikroORM은 entity별로 `EntityMetadata` 객체를 가진다. 핵심 전략:

```ts
function OverrideType(parentClass, overrides) {
  // 1. 새 클래스 생성 (부모 상속)
  abstract class DerivedClass extends parentClass {}

  // 2. 부모 메타데이터를 글로벌 저장소에서 가져옴
  const parentMeta = getMetadataFromDecorator(parentClass);

  // 3. 새 클래스용 메타데이터 생성 (글로벌 저장소에 등록됨)
  const childMeta = getMetadataFromDecorator(DerivedClass);

  // 4. 부모의 properties를 깊은 복사
  for (const [name, prop] of Object.entries(parentMeta.properties ?? {})) {
    childMeta.properties[name] = { ...prop };
  }

  // 5. override 대상의 customType 교체
  for (const [propName, customType] of Object.entries(overrides)) {
    if (childMeta.properties[propName]) {
      childMeta.properties[propName].customType = customType;
      // type도 교체해야 discovery에서 올바르게 인식
      childMeta.properties[propName].type = customType.constructor.name;
    }
  }

  return DerivedClass;
}
```

### 4.4 주의사항 / 검증 필요 사항

1. **ES decorator 메타데이터 상속**: ES decorators에서 `context.metadata`는 프로토타입 체인으로 상속된다. `class Child extends Parent`면 Child의 `context.metadata`가 Parent의 것을 프로토타입으로 가질 수 있다. `prepareMetadataContext`에서 `Object.hasOwn` 체크 + shallow copy하는 부분 참고.

2. **`@Entity()` 데코레이터와의 상호작용**: `OverrideType`이 반환하는 클래스에 `@Entity()`를 붙이면, `getMetadataFromDecorator`가 다시 호출된다. 이때 이미 설정한 properties가 덮어씌워지지 않는지 확인 필요.

3. **Discovery 타이밍**: `OverrideType`은 데코레이터 시점(모듈 로드 시)에 실행된다. MikroORM `init()` → discovery는 그 이후. discovery가 properties를 재처리할 때 `customType`이 유지되는지 확인 필요.

4. **`meta.sync()` 호출**: properties 변경 후 `sync()`를 호출해야 파생 배열(props, relations 등)이 갱신된다. 하지만 데코레이터 시점에는 아직 `sync()`를 호출할 필요가 없을 수 있다 (discovery가 해주므로).

5. **같은 테이블 다중 entity**: MikroORM이 같은 tableName + schema 조합으로 두 개의 entity를 허용하는지 확인 필요. 허용하지 않으면 부모 entity를 `abstract`로 만들거나, 부모를 discovery 대상에서 제외하는 전략이 필요.

6. **`IType<T, string>` 브랜딩**: 생성된 entity에서 `siteCode: IType<SiteCode, string>` 같은 브랜딩 타입이 있다. `ApplyOverrides`가 이런 타입도 정확히 처리하는지 확인.

---

## 5. 생성된 Entity 예시

`@imwebme/mikro-models`에서 생성되는 entity의 실제 모습:

```ts
// src/doznut_shop/shop-order.ts (자동 생성됨)
import type { SiteCode, UnitCode }                   from '@imwebme/types';
import { type IType, type Opt, PrimaryKeyProp }      from '@mikro-orm/core';
import { Entity, Enum, Index, PrimaryKey, Property } from '@mikro-orm/decorators/es';
import { BooleanType }                               from '../types/boolean-type.js';

@Entity({ schema: 'doznut_shop', comment: '주문 정보' })
export class ShopOrder {
  [PrimaryKeyProp]?: 'idx';

  @PrimaryKey({ type: 'integer', comment: '주문 고유번호' })
  idx!: number;

  @Property({ type: 'character', length: 22, comment: '주문 고유코드', unique: 'code' })
  code!: string;

  @Property({ type: 'character', columnType: 'char(22)', comment: '사이트코드' })
  siteCode!: IType<SiteCode, string>;

  // text 타입 → unknown으로 생성됨
  @Property({ type: 'unknown', columnType: 'tinytext', nullable: true, 
              comment: '해당 주문서 환불 총 데이터', ignoreSchemaChanges: ['type'] })
  refundData: unknown = null;

  // text 타입이지만 string으로 생성되는 경우도 있음
  @Property({ type: 'text', length: 65535, nullable: true, comment: '무통장입금정보 (JSON)' })
  payBankInfo: string | null = null;

  @Property({ type: BooleanType, columnType: `enum('Y','N')`, comment: '선물하기 주문 여부' })
  isGift!: boolean;

  // ... 수십 개의 프로퍼티
}
```

### Override 후 기대하는 모습

```ts
@Entity({ tableName: 'shop_order', schema: 'doznut_shop' })
class AppShopOrder extends OverrideType(ShopOrder, {
  refundData: new PhpSerializedType<RefundData>(),
  payBankInfo: new PhpSerializedType<BankInfo>(),
}) {}

// TS 타입:
// AppShopOrder.idx         → number          (그대로)
// AppShopOrder.code        → string          (그대로)
// AppShopOrder.siteCode    → IType<SiteCode, string>  (그대로)
// AppShopOrder.refundData  → RefundData | null         (override, nullable 보존)
// AppShopOrder.payBankInfo → BankInfo | null            (override, nullable 보존)
// AppShopOrder.isGift      → boolean         (그대로)
```

---

## 6. 프로젝트 설정

### 기술 스택

- **TypeScript 5.x** (ES decorators 지원)
- **MikroORM v7** (peerDependency)
- **ESM** (type: "module")
- **Node.js >= 20**

### 패키지 구조 (제안)

```
mikro-mapped-types/
├── src/
│   ├── index.ts              # barrel export
│   ├── override-type.ts      # OverrideType() 메인 구현
│   └── types.ts              # TS 유틸리티 타입 (InferJSType, ApplyOverrides 등)
├── tests/
│   └── override-type.spec.ts # OverrideType 테스트
├── package.json
├── tsconfig.json
└── CONTEXT.md                # 이 문서
```

### peerDependencies

```json
{
  "peerDependencies": {
    "@mikro-orm/core": ">=7.0.0"
  }
}
```

### 테스트 전략

1. **타입 테스트**: `expectTypeOf` (vitest) 또는 `tsd`로 `ApplyOverrides` 타입 추론 검증
2. **메타데이터 테스트**: `OverrideType` 호출 후 `MetadataStorage`에서 자식 클래스의 properties를 확인하여 customType이 교체되었는지 검증
3. **통합 테스트**: SQLite in-memory DB로 실제 `em.findOne()` 수행하여 customType의 `convertToJSValue`가 호출되는지 검증

---

## 7. 커스텀 타입 예시: PhpSerializedType

Application에서 사용할 커스텀 타입 예시 (이 라이브러리에 포함하지 않음, 참고용):

```ts
import { Type } from '@mikro-orm/core';

export class PhpSerializedType<T = Record<string, unknown>> extends Type<T, string> {
  override convertToDatabaseValue(value: T): string {
    // application에서 구현
    return phpSerialize(value);
  }

  override convertToJSValue(value: string): T {
    // application에서 구현
    return phpUnserialize(value) as T;
  }

  override getColumnType(): string {
    return 'text';
  }
}
```

핵심: `Type<T, string>`의 제네릭 파라미터 `T`가 `InferJSType`으로 추출되어 entity 프로퍼티의 TS 타입이 된다.

import { deprecate } from '@ember/debug';

import { LOG_CACHE_POLICY } from '@warp-drive/build-config/debugging';
import { TESTING } from '@warp-drive/build-config/env';
import { assert } from '@warp-drive/build-config/macros';
import { getOrSetGlobal } from '@warp-drive/core/types/-private';
import type { Cache } from '@warp-drive/core/types/cache';
import type { StableDocumentIdentifier, StableRecordIdentifier } from '@warp-drive/core/types/identifier';
import type { QueryParamsSerializationOptions, QueryParamsSource, Serializable } from '@warp-drive/core/types/params';
import type { ImmutableRequestInfo, ResponseInfo, StructuredDocument } from '@warp-drive/core/types/request';
import type { ResourceDocument } from '@warp-drive/core/types/spec/document';

import { LRUCache } from './-private/string/transform.ts';

type UnsubscribeToken = object;
type CacheOperation = 'added' | 'removed' | 'updated' | 'state';
type DocumentCacheOperation = 'invalidated' | 'added' | 'removed' | 'updated' | 'state';

export interface NotificationCallback {
  (identifier: StableRecordIdentifier, notificationType: 'attributes' | 'relationships', key?: string): void;
  (identifier: StableRecordIdentifier, notificationType: 'errors' | 'meta' | 'identity' | 'state'): void;
  // (identifier: StableRecordIdentifier, notificationType: NotificationType, key?: string): void;
}

interface ResourceOperationCallback {
  // resource updates
  (identifier: StableRecordIdentifier, notificationType: CacheOperation): void;
}

interface DocumentOperationCallback {
  // document updates
  (identifier: StableDocumentIdentifier, notificationType: DocumentCacheOperation): void;
}

type NotificationManager = {
  subscribe(identifier: StableRecordIdentifier, callback: NotificationCallback): UnsubscribeToken;
  subscribe(identifier: 'resource', callback: ResourceOperationCallback): UnsubscribeToken;
  subscribe(identifier: 'document' | StableDocumentIdentifier, callback: DocumentOperationCallback): UnsubscribeToken;

  notify(identifier: StableRecordIdentifier, value: 'attributes' | 'relationships', key?: string): boolean;
  notify(identifier: StableRecordIdentifier, value: 'errors' | 'meta' | 'identity' | 'state'): boolean;
  notify(identifier: StableRecordIdentifier, value: CacheOperation): boolean;
  notify(identifier: StableDocumentIdentifier, value: DocumentCacheOperation): boolean;
};

type Store = {
  cache: Cache;
  notifications: NotificationManager;
};

/**
 * Simple utility function to assist in url building,
 * query params, and other common request operations.
 *
 * These primitives may be used directly or composed
 * by request builders to provide a consistent interface
 * for building requests.
 *
 * For instance:
 *
 * ```ts
 * import { buildBaseURL, buildQueryParams } from '@ember-data/request-utils';
 *
 * const baseURL = buildBaseURL({
 *   host: 'https://api.example.com',
 *   namespace: 'api/v1',
 *   resourcePath: 'emberDevelopers',
 *   op: 'query',
 *   identifier: { type: 'ember-developer' }
 * });
 * const url = `${baseURL}?${buildQueryParams({ name: 'Chris', include:['pets'] })}`;
 * // => 'https://api.example.com/api/v1/emberDevelopers?include=pets&name=Chris'
 * ```
 *
 * This is useful, but not as useful as the REST request builder for query which is sugar
 * over this (and more!):
 *
 * ```ts
 * import { query } from '@ember-data/rest/request';
 *
 * const options = query('ember-developer', { name: 'Chris', include:['pets'] });
 * // => { url: 'https://api.example.com/api/v1/emberDevelopers?include=pets&name=Chris' }
 * // Note: options will also include other request options like headers, method, etc.
 * ```
 *
 * @module
 * @public
 */

// prevents the final constructed object from needing to add
// host and namespace which are provided by the final consuming
// class to the prototype which can result in overwrite errors

export interface BuildURLConfig {
  host: string | null;
  namespace: string | null;
}

const CONFIG: BuildURLConfig = getOrSetGlobal('CONFIG', {
  host: '',
  namespace: '',
});

/**
 * Sets the global configuration for `buildBaseURL`
 * for host and namespace values for the application.
 *
 * These values may still be overridden by passing
 * them to buildBaseURL directly.
 *
 * This method may be called as many times as needed.
 * host values of `''` or `'/'` are equivalent.
 *
 * Except for the value of `/` as host, host should not
 * end with `/`.
 *
 * namespace should not start or end with a `/`.
 *
 * ```ts
 * type BuildURLConfig = {
 *   host: string;
 *   namespace: string'
 * }
 * ```
 *
 * Example:
 *
 * ```ts
 * import { setBuildURLConfig } from '@ember-data/request-utils';
 *
 * setBuildURLConfig({
 *   host: 'https://api.example.com',
 *   namespace: 'api/v1'
 * });
 * ```
 *
 * @public
 * @param {BuildURLConfig} config
 * @return {void}
 */
export function setBuildURLConfig(config: BuildURLConfig) {
  assert(`setBuildURLConfig: You must pass a config object`, config);
  assert(
    `setBuildURLConfig: You must pass a config object with a 'host' or 'namespace' property`,
    'host' in config || 'namespace' in config
  );

  CONFIG.host = config.host || '';
  CONFIG.namespace = config.namespace || '';

  assert(
    `buildBaseURL: host must NOT end with '/', received '${CONFIG.host}'`,
    CONFIG.host === '/' || !CONFIG.host.endsWith('/')
  );
  assert(
    `buildBaseURL: namespace must NOT start with '/', received '${CONFIG.namespace}'`,
    !CONFIG.namespace.startsWith('/')
  );
  assert(
    `buildBaseURL: namespace must NOT end with '/', received '${CONFIG.namespace}'`,
    !CONFIG.namespace.endsWith('/')
  );
}

export interface FindRecordUrlOptions {
  op: 'findRecord';
  identifier: { type: string; id: string };
  resourcePath?: string;
  host?: string;
  namespace?: string;
}

export interface QueryUrlOptions {
  op: 'query';
  identifier: { type: string };
  resourcePath?: string;
  host?: string;
  namespace?: string;
}

export interface FindManyUrlOptions {
  op: 'findMany';
  identifiers: { type: string; id: string }[];
  resourcePath?: string;
  host?: string;
  namespace?: string;
}
export interface FindRelatedCollectionUrlOptions {
  op: 'findRelatedCollection';
  identifier: { type: string; id: string };
  fieldPath: string;
  resourcePath?: string;
  host?: string;
  namespace?: string;
}

export interface FindRelatedResourceUrlOptions {
  op: 'findRelatedRecord';
  identifier: { type: string; id: string };
  fieldPath: string;
  resourcePath?: string;
  host?: string;
  namespace?: string;
}

export interface CreateRecordUrlOptions {
  op: 'createRecord';
  identifier: { type: string };
  resourcePath?: string;
  host?: string;
  namespace?: string;
}

export interface UpdateRecordUrlOptions {
  op: 'updateRecord';
  identifier: { type: string; id: string };
  resourcePath?: string;
  host?: string;
  namespace?: string;
}

export interface DeleteRecordUrlOptions {
  op: 'deleteRecord';
  identifier: { type: string; id: string };
  resourcePath?: string;
  host?: string;
  namespace?: string;
}

export interface GenericUrlOptions {
  resourcePath: string;
  host?: string;
  namespace?: string;
}

export type UrlOptions =
  | FindRecordUrlOptions
  | QueryUrlOptions
  | FindManyUrlOptions
  | FindRelatedCollectionUrlOptions
  | FindRelatedResourceUrlOptions
  | CreateRecordUrlOptions
  | UpdateRecordUrlOptions
  | DeleteRecordUrlOptions
  | GenericUrlOptions;

const OPERATIONS_WITH_PRIMARY_RECORDS = new Set([
  'findRecord',
  'findRelatedRecord',
  'findRelatedCollection',
  'updateRecord',
  'deleteRecord',
]);

function isOperationWithPrimaryRecord(
  options: UrlOptions
): options is
  | FindRecordUrlOptions
  | FindRelatedCollectionUrlOptions
  | FindRelatedResourceUrlOptions
  | UpdateRecordUrlOptions
  | DeleteRecordUrlOptions {
  return 'op' in options && OPERATIONS_WITH_PRIMARY_RECORDS.has(options.op);
}

function hasResourcePath(options: UrlOptions): options is GenericUrlOptions {
  return 'resourcePath' in options && typeof options.resourcePath === 'string' && options.resourcePath.length > 0;
}

function resourcePathForType(options: UrlOptions): string {
  assert(
    `resourcePathForType: You must pass a valid op as part of options`,
    'op' in options && typeof options.op === 'string'
  );
  return options.op === 'findMany' ? options.identifiers[0].type : options.identifier.type;
}

/**
 * Builds a URL for a request based on the provided options.
 * Does not include support for building query params (see `buildQueryParams`)
 * so that it may be composed cleanly with other query-params strategies.
 *
 * Usage:
 *
 * ```ts
 * import { buildBaseURL } from '@ember-data/request-utils';
 *
 * const url = buildBaseURL({
 *   host: 'https://api.example.com',
 *   namespace: 'api/v1',
 *   resourcePath: 'emberDevelopers',
 *   op: 'query',
 *   identifier: { type: 'ember-developer' }
 * });
 *
 * // => 'https://api.example.com/api/v1/emberDevelopers'
 * ```
 *
 * On the surface this may seem like a lot of work to do something simple, but
 * it is designed to be composable with other utilities and interfaces that the
 * average product engineer will never need to see or use.
 *
 * A few notes:
 *
 * - `resourcePath` is optional, but if it is not provided, `identifier.type` will be used.
 * - `host` and `namespace` are optional, but if they are not provided, the values globally
 *    configured via `setBuildURLConfig` will be used.
 * - `op` is required and must be one of the following:
 *   - 'findRecord' 'query' 'findMany' 'findRelatedCollection' 'findRelatedRecord'` 'createRecord' 'updateRecord' 'deleteRecord'
 * - Depending on the value of `op`, `identifier` or `identifiers` will be required.
 *
 * @public
 * @param urlOptions
 * @return {String}
 */
export function buildBaseURL(urlOptions: UrlOptions): string {
  const options = Object.assign(
    {
      host: CONFIG.host,
      namespace: CONFIG.namespace,
    },
    urlOptions
  );
  assert(
    `buildBaseURL: You must pass \`op\` as part of options`,
    hasResourcePath(options) || (typeof options.op === 'string' && options.op.length > 0)
  );
  assert(
    `buildBaseURL: You must pass \`identifier\` as part of options`,
    hasResourcePath(options) ||
      options.op === 'findMany' ||
      (options.identifier && typeof options.identifier === 'object')
  );
  assert(
    `buildBaseURL: You must pass \`identifiers\` as part of options`,
    hasResourcePath(options) ||
      options.op !== 'findMany' ||
      (options.identifiers &&
        Array.isArray(options.identifiers) &&
        options.identifiers.length > 0 &&
        options.identifiers.every((i) => i && typeof i === 'object'))
  );
  assert(
    `buildBaseURL: You must pass valid \`identifier\` as part of options, expected 'id'`,
    hasResourcePath(options) ||
      !isOperationWithPrimaryRecord(options) ||
      (typeof options.identifier.id === 'string' && options.identifier.id.length > 0)
  );
  assert(
    `buildBaseURL: You must pass \`identifiers\` as part of options`,
    hasResourcePath(options) ||
      options.op !== 'findMany' ||
      options.identifiers.every((i) => typeof i.id === 'string' && i.id.length > 0)
  );
  assert(
    `buildBaseURL: You must pass valid \`identifier\` as part of options, expected 'type'`,
    hasResourcePath(options) ||
      options.op === 'findMany' ||
      (typeof options.identifier.type === 'string' && options.identifier.type.length > 0)
  );
  assert(
    `buildBaseURL: You must pass valid \`identifiers\` as part of options, expected 'type'`,
    hasResourcePath(options) ||
      options.op !== 'findMany' ||
      (typeof options.identifiers[0].type === 'string' && options.identifiers[0].type.length > 0)
  );

  // prettier-ignore
  const idPath: string =
      isOperationWithPrimaryRecord(options) ? encodeURIComponent(options.identifier.id)
      : '';
  const resourcePath = options.resourcePath || resourcePathForType(options);
  const { host, namespace } = options;
  const fieldPath = 'fieldPath' in options ? options.fieldPath : '';

  assert(
    `buildBaseURL: You tried to build a url for a ${String(
      'op' in options ? options.op + ' ' : ''
    )}request to ${resourcePath} but resourcePath must be set or op must be one of "${[
      'findRecord',
      'findRelatedRecord',
      'findRelatedCollection',
      'updateRecord',
      'deleteRecord',
      'createRecord',
      'query',
      'findMany',
    ].join('","')}".`,
    hasResourcePath(options) ||
      [
        'findRecord',
        'query',
        'findMany',
        'findRelatedCollection',
        'findRelatedRecord',
        'createRecord',
        'updateRecord',
        'deleteRecord',
      ].includes(options.op)
  );

  assert(`buildBaseURL: host must NOT end with '/', received '${host}'`, host === '/' || !host.endsWith('/'));
  assert(`buildBaseURL: namespace must NOT start with '/', received '${namespace}'`, !namespace.startsWith('/'));
  assert(`buildBaseURL: namespace must NOT end with '/', received '${namespace}'`, !namespace.endsWith('/'));
  assert(
    `buildBaseURL: resourcePath must NOT start with '/', received '${resourcePath}'`,
    !resourcePath.startsWith('/')
  );
  assert(`buildBaseURL: resourcePath must NOT end with '/', received '${resourcePath}'`, !resourcePath.endsWith('/'));
  assert(`buildBaseURL: fieldPath must NOT start with '/', received '${fieldPath}'`, !fieldPath.startsWith('/'));
  assert(`buildBaseURL: fieldPath must NOT end with '/', received '${fieldPath}'`, !fieldPath.endsWith('/'));
  assert(`buildBaseURL: idPath must NOT start with '/', received '${idPath}'`, !idPath.startsWith('/'));
  assert(`buildBaseURL: idPath must NOT end with '/', received '${idPath}'`, !idPath.endsWith('/'));

  const hasHost = host !== '' && host !== '/';
  const url = [hasHost ? host : '', namespace, resourcePath, idPath, fieldPath].filter(Boolean).join('/');
  return hasHost ? url : `/${url}`;
}

const DEFAULT_QUERY_PARAMS_SERIALIZATION_OPTIONS: QueryParamsSerializationOptions = {
  arrayFormat: 'comma',
};

function handleInclude(include: string | string[]): string[] {
  assert(
    `Expected include to be a string or array, got ${typeof include}`,
    typeof include === 'string' || Array.isArray(include)
  );
  return typeof include === 'string' ? include.split(',') : include;
}

/**
 * filter out keys of an object that have falsy values or point to empty arrays
 * returning a new object with only those keys that have truthy values / non-empty arrays
 *
 * @public
 * @param {Record<string, Serializable>} source object to filter keys with empty values from
 * @return {Record<string, Serializable>} A new object with the keys that contained empty values removed
 */
export function filterEmpty(source: Record<string, Serializable>): Record<string, Serializable> {
  const result: Record<string, Serializable> = {};
  for (const key in source) {
    const value = source[key];
    // Allow `0` and `false` but filter falsy values that indicate "empty"
    if (value !== undefined && value !== null && value !== '') {
      if (!Array.isArray(value) || value.length > 0) {
        result[key] = source[key];
      }
    }
  }
  return result;
}

/**
 * Sorts query params by both key and value returning a new URLSearchParams
 * object with the keys inserted in sorted order.
 *
 * Treats `included` specially, splicing it into an array if it is a string and sorting the array.
 *
 * Options:
 * - arrayFormat: 'bracket' | 'indices' | 'repeat' | 'comma'
 *
 * 'bracket': appends [] to the key for every value e.g. `&ids[]=1&ids[]=2`
 * 'indices': appends [i] to the key for every value e.g. `&ids[0]=1&ids[1]=2`
 * 'repeat': appends the key for every value e.g. `&ids=1&ids=2`
 * 'comma' (default): appends the key once with a comma separated list of values e.g. `&ids=1,2`
 *
 * @public
 * @param {URLSearchParams | object} params
 * @param {Object} options
 * @return {URLSearchParams} A URLSearchParams with keys inserted in sorted order
 */
export function sortQueryParams(params: QueryParamsSource, options?: QueryParamsSerializationOptions): URLSearchParams {
  const opts = Object.assign({}, DEFAULT_QUERY_PARAMS_SERIALIZATION_OPTIONS, options);
  const paramsIsObject = !(params instanceof URLSearchParams);
  const urlParams = new URLSearchParams();
  const dictionaryParams: Record<string, Serializable> = paramsIsObject ? params : {};

  if (!paramsIsObject) {
    params.forEach((value, key) => {
      const hasExisting = key in dictionaryParams;
      if (!hasExisting) {
        dictionaryParams[key] = value;
      } else {
        const existingValue = dictionaryParams[key];
        if (Array.isArray(existingValue)) {
          existingValue.push(value);
        } else {
          dictionaryParams[key] = [existingValue, value];
        }
      }
    });
  }

  if ('include' in dictionaryParams) {
    dictionaryParams.include = handleInclude(dictionaryParams.include as string | string[]);
  }

  const sortedKeys = Object.keys(dictionaryParams).sort();
  sortedKeys.forEach((key) => {
    const value = dictionaryParams[key];
    if (Array.isArray(value)) {
      value.sort();
      switch (opts.arrayFormat) {
        case 'indices':
          value.forEach((v, i) => {
            urlParams.append(`${key}[${i}]`, String(v));
          });
          return;
        case 'bracket':
          value.forEach((v) => {
            urlParams.append(`${key}[]`, String(v));
          });
          return;
        case 'repeat':
          value.forEach((v) => {
            urlParams.append(key, String(v));
          });
          return;
        case 'comma':
        default:
          urlParams.append(key, value.join(','));
          return;
      }
    } else {
      urlParams.append(key, String(value));
    }
  });

  return urlParams;
}

/**
 * Sorts query params by both key and value, returning a query params string
 *
 * Treats `included` specially, splicing it into an array if it is a string and sorting the array.
 *
 * Options:
 * - arrayFormat: 'bracket' | 'indices' | 'repeat' | 'comma'
 *
 * 'bracket': appends [] to the key for every value e.g. `ids[]=1&ids[]=2`
 * 'indices': appends [i] to the key for every value e.g. `ids[0]=1&ids[1]=2`
 * 'repeat': appends the key for every value e.g. `ids=1&ids=2`
 * 'comma' (default): appends the key once with a comma separated list of values e.g. `ids=1,2`
 *
 * @public
 * @param {URLSearchParams | Object} params
 * @param {Object} [options]
 * @return {String} A sorted query params string without the leading `?`
 */
export function buildQueryParams(params: QueryParamsSource, options?: QueryParamsSerializationOptions): string {
  return sortQueryParams(params, options).toString();
}
export interface CacheControlValue {
  immutable?: boolean;
  'max-age'?: number;
  'must-revalidate'?: boolean;
  'must-understand'?: boolean;
  'no-cache'?: boolean;
  'no-store'?: boolean;
  'no-transform'?: boolean;
  'only-if-cached'?: boolean;
  private?: boolean;
  'proxy-revalidate'?: boolean;
  public?: boolean;
  's-maxage'?: number;
  'stale-if-error'?: number;
  'stale-while-revalidate'?: number;
}

type CacheControlKey = keyof CacheControlValue;

const NUMERIC_KEYS = new Set(['max-age', 's-maxage', 'stale-if-error', 'stale-while-revalidate']);

/**
 *  Parses a string Cache-Control header value into an object with the following structure:
 *
 * ```ts
 * interface CacheControlValue {
 *   immutable?: boolean;
 *   'max-age'?: number;
 *   'must-revalidate'?: boolean;
 *   'must-understand'?: boolean;
 *   'no-cache'?: boolean;
 *   'no-store'?: boolean;
 *   'no-transform'?: boolean;
 *   'only-if-cached'?: boolean;
 *   private?: boolean;
 *   'proxy-revalidate'?: boolean;
 *   public?: boolean;
 *   's-maxage'?: number;
 *   'stale-if-error'?: number;
 *   'stale-while-revalidate'?: number;
 * }
 * ```
 * @public
 * @param {String} header
 * @return {CacheControlValue}
 */
export function parseCacheControl(header: string): CacheControlValue {
  return CACHE_CONTROL_CACHE.get(header);
}

const CACHE_CONTROL_CACHE = new LRUCache((header: string) => {
  let key: CacheControlKey = '' as CacheControlKey;
  let value = '';
  let isParsingKey = true;
  const cacheControlValue: CacheControlValue = {};

  for (let i = 0; i < header.length; i++) {
    const char = header.charAt(i);
    if (char === ',') {
      assert(`Invalid Cache-Control value, expected a value`, !isParsingKey || !NUMERIC_KEYS.has(key));
      assert(
        `Invalid Cache-Control value, expected a value after "=" but got ","`,
        i === 0 || header.charAt(i - 1) !== '='
      );
      isParsingKey = true;
      // @ts-expect-error TS incorrectly thinks that optional keys must have a type that includes undefined
      cacheControlValue[key] = NUMERIC_KEYS.has(key) ? parseCacheControlValue(value) : true;
      key = '' as CacheControlKey;
      value = '';
      continue;
    } else if (char === '=') {
      assert(`Invalid Cache-Control value, expected a value after "="`, i + 1 !== header.length);
      isParsingKey = false;
    } else if (char === ' ' || char === `\t` || char === `\n`) {
      continue;
    } else if (isParsingKey) {
      key += char;
    } else {
      value += char;
    }

    if (i === header.length - 1) {
      // @ts-expect-error TS incorrectly thinks that optional keys must have a type that includes undefined
      cacheControlValue[key] = NUMERIC_KEYS.has(key) ? parseCacheControlValue(value) : true;
    }
  }

  return cacheControlValue;
}, 200);

function parseCacheControlValue(stringToParse: string): number {
  const parsedValue = Number.parseInt(stringToParse);
  assert(`Invalid Cache-Control value, expected a number but got - ${stringToParse}`, !Number.isNaN(parsedValue));
  assert(`Invalid Cache-Control value, expected a number greater than 0 but got - ${stringToParse}`, parsedValue >= 0);
  if (Number.isNaN(parsedValue) || parsedValue < 0) {
    return 0;
  }

  return parsedValue;
}

function isExpired(
  identifier: StableDocumentIdentifier,
  request: StructuredDocument<ResourceDocument>,
  config: PolicyConfig
): boolean {
  const { constraints } = config;

  if (constraints?.isExpired) {
    const result = constraints.isExpired(request);
    if (result !== null) {
      if (LOG_CACHE_POLICY) {
        // eslint-disable-next-line no-console
        console.log(
          `CachePolicy: ${identifier.lid} is ${result ? 'EXPIRED' : 'NOT expired'} because constraints.isExpired returned ${result}`
        );
      }
      return result;
    }
  }

  const { headers } = request.response!;

  if (!headers) {
    if (LOG_CACHE_POLICY) {
      // eslint-disable-next-line no-console
      console.log(`CachePolicy: ${identifier.lid} is EXPIRED because no headers were provided`);
    }

    // if we have no headers then both the headers based expiration
    // and the time based expiration will be considered expired
    return true;
  }

  // check for X-WarpDrive-Expires
  const now = Date.now();
  const date = headers.get('Date');

  if (constraints?.headers) {
    if (constraints.headers['X-WarpDrive-Expires']) {
      const xWarpDriveExpires = headers.get('X-WarpDrive-Expires');
      if (xWarpDriveExpires) {
        const expirationTime = new Date(xWarpDriveExpires).getTime();
        const result = now >= expirationTime;
        if (LOG_CACHE_POLICY) {
          // eslint-disable-next-line no-console
          console.log(
            `CachePolicy: ${identifier.lid} is ${result ? 'EXPIRED' : 'NOT expired'} because the time set by X-WarpDrive-Expires header is ${result ? 'in the past' : 'in the future'}`
          );
        }
        return result;
      }
    }

    // check for Cache-Control
    if (constraints.headers['Cache-Control']) {
      const cacheControl = headers.get('Cache-Control');
      const age = headers.get('Age');

      if (cacheControl && age && date) {
        const cacheControlValue = parseCacheControl(cacheControl);

        // max-age and s-maxage are stored in
        const maxAge = cacheControlValue['max-age'] || cacheControlValue['s-maxage'];

        if (maxAge) {
          // age is stored in seconds
          const ageValue = parseInt(age, 10);
          assert(`Invalid Cache-Control value, expected a number but got - ${age}`, !Number.isNaN(ageValue));
          assert(`Invalid Cache-Control value, expected a number greater than 0 but got - ${age}`, ageValue >= 0);

          if (!Number.isNaN(ageValue) && ageValue >= 0) {
            const dateValue = new Date(date).getTime();
            const expirationTime = dateValue + (maxAge - ageValue) * 1000;
            const result = now >= expirationTime;

            if (LOG_CACHE_POLICY) {
              // eslint-disable-next-line no-console
              console.log(
                `CachePolicy: ${identifier.lid} is ${result ? 'EXPIRED' : 'NOT expired'} because the time set by Cache-Control header is ${result ? 'in the past' : 'in the future'}`
              );
            }

            return result;
          }
        }
      }
    }

    // check for Expires
    if (constraints.headers.Expires) {
      const expires = headers.get('Expires');
      if (expires) {
        const expirationTime = new Date(expires).getTime();
        const result = now >= expirationTime;
        if (LOG_CACHE_POLICY) {
          // eslint-disable-next-line no-console
          console.log(
            `CachePolicy: ${identifier.lid} is ${result ? 'EXPIRED' : 'NOT expired'} because the time set by Expires header is ${result ? 'in the past' : 'in the future'}`
          );
        }
        return result;
      }
    }
  }

  // check for Date
  if (!date) {
    if (LOG_CACHE_POLICY) {
      // eslint-disable-next-line no-console
      console.log(`CachePolicy: ${identifier.lid} is EXPIRED because no Date header was provided`);
    }
    return true;
  }

  let expirationTime = config.apiCacheHardExpires;
  if (TESTING) {
    if (!config.disableTestOptimization) {
      expirationTime = config.apiCacheSoftExpires;
    }
  }

  const time = new Date(date).getTime();
  const deadline = time + expirationTime;
  const result = now >= deadline;

  if (LOG_CACHE_POLICY) {
    // eslint-disable-next-line no-console
    console.log(
      `CachePolicy: ${identifier.lid} is ${result ? 'EXPIRED' : 'NOT expired'} because the apiCacheHardExpires time since the response's Date header is ${result ? 'in the past' : 'in the future'}`
    );
  }

  return result;
}

/**
 * The configuration options for the CachePolicy
 * provided by `@ember-data/request-utils`.
 *
 * ```ts
 * import { CachePolicy } from '@ember-data/request-utils';
 *
 * new CachePolicy({
 *   // ... PolicyConfig Settings ... //
 * });
 * ```
 *
 */
export type PolicyConfig = {
  /**
   * the number of milliseconds after which a request is considered
   * stale. If a request is issued again after this time, the request
   * will respond from cache immediately while a background request
   * is made to update the cache.
   *
   * This is calculated against the `date` header of the response.
   *
   * If your API does not provide a `date` header, the `Fetch` handler
   * provided by `@ember-data/request/fetch` will automatically add
   * it to responses if it is not present. Responses without a `date`
   * header will be considered stale immediately.
   *
   */
  apiCacheSoftExpires: number;
  /**
   * the number of milliseconds after which a request is considered
   * expired and should be re-fetched. If a request is issued again
   * after this time, the request will disregard the cache and
   * wait for a fresh response from the API.
   *
   * This is calculated against the `date` header of the response.
   *
   * If your API does not provide a `date` header, the `Fetch` handler
   * provided by `@ember-data/request/fetch` will automatically add
   * it to responses if it is not present. Responses without a `date`
   * header will be considered hard expired immediately.
   *
   */
  apiCacheHardExpires: number;
  /**
   * In Testing environments, the `apiCacheSoftExpires` will always be `false`
   * and `apiCacheHardExpires` will use the `apiCacheSoftExpires` value.
   *
   * This helps reduce flakiness and produce predictably rendered results in test suites.
   *
   * Requests that specifically set `cacheOptions.backgroundReload = true` will
   * still be background reloaded in tests.
   *
   * This behavior can be opted out of by setting this value to `true`.
   *
   */
  disableTestOptimization?: boolean;

  /**
   * In addition to the simple time-based expiration strategy, CachePolicy
   * supports various common server-supplied expiration strategies via
   * headers, as well as custom expiration strategies via the `isExpired`
   * function.
   *
   * Requests will be validated for expiration against these constraints.
   * If any of these constraints are not met, the request will be considered
   * expired. If all constraints are met, the request will be considered
   * valid and the time based expiration strategy will NOT be used.
   *
   * Meeting a constraint means BOTH that the properties the constraint
   * requires are present AND that the expiration time indicated by those
   * properties has not been exceeded.
   *
   * In other words, if the properties for a constraint are not present,
   * this does not count either as meeting or as not meeting the constraint,
   * the constraint simply does not apply.
   *
   * The `isExpired` function is called with the request and should return
   * `true` if the request is expired, `false` if it is not expired, and
   * `null` if the expiration status is unknown.
   *
   * In order constraints are checked:
   *
   * - isExpired function
   * -  ↳ (if null) X-WarpDrive-Expires header
   * -  ↳ (if null) Cache-Control header
   * -  ↳ (if null) Expires header
   *
   */
  constraints?: {
    /**
     * Headers that should be checked for expiration.
     *
     */
    headers?: {
      /**
       * Whether the `Cache-Control` header should be checked for expiration.
       * If `true`, then the `max-age` and `s-maxage` directives are used alongside
       * the `Age` and `Date` headers to determine if the expiration time has passed.
       *
       * Other directives are ignored.
       *
       * 'Cache-Control' will take precedence over 'Expires' if both are present
       * and both configured to be checked.
       *
       */
      'Cache-Control'?: boolean;

      /**
       * Whether the `Expires` header should be checked for expiration.
       *
       * If `true`, then the `Expires` header is used to caclulate the expiration time
       * and determine if the expiration time has passed.
       *
       * 'Cache-Control' will take precedence over 'Expires' if both are present.
       *
       */
      Expires?: boolean;

      /**
       * Whether the `X-WarpDrive-Expires` header should be checked for expiration.
       *
       * If `true`, then the `X-WarpDrive-Expires` header is used to caclulate the expiration time
       * and determine if the expiration time has passed.
       *
       * This header will take precedence over 'Cache-Control' and 'Expires' if all three are present.
       *
       * The header's value should be a [UTC date string](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toUTCString).
       *
       */
      'X-WarpDrive-Expires'?: boolean;
    };

    /**
     * A function that should be called to determine if the request is expired.
     *
     * If present, this function will be called with the request and should return
     * `true` if the request is expired, `false` if it is not expired, and
     * `null` if the expiration status is unknown.
     *
     * If the function does not return `null`,
     *
     */
    isExpired?: (request: StructuredDocument<ResourceDocument>) => boolean | null;
  };
};

/**
 * A basic CachePolicy that can be added to the Store service.
 *
 * Determines staleness based on time since the request was last received from the API
 * using the `date` header.
 *
 * Determines expiration based on configured constraints as well as a time based
 * expiration strategy based on the `date` header.
 *
 * In order expiration is determined by:
 *
 * - Is explicitly invalidated
 * -  ↳ (if null) isExpired function \<IF Constraint Active>
 * -  ↳ (if null) X-WarpDrive-Expires header \<IF Constraint Active>
 * -  ↳ (if null) Cache-Control header \<IF Constraint Active>
 * -  ↳ (if null) Expires header \<IF Constraint Active>
 * -  ↳ (if null) Date header + apiCacheHardExpires \< current time
 *
 * Invalidates any request for which `cacheOptions.types` was provided when a createRecord
 * request for that type is successful.
 *
 * For this to work, the `createRecord` request must include the `cacheOptions.types` array
 * with the types that should be invalidated, or its request should specify the identifiers
 * of the records that are being created via `records`. Providing both is valid.
 *
 * > [!NOTE]
 * > only requests that had specified `cacheOptions.types` and occurred prior to the
 * > createRecord request will be invalidated. This means that a given request should always
 * > specify the types that would invalidate it to opt into this behavior. Abstracting this
 * > behavior via builders is recommended to ensure consistency.
 *
 * This allows the Store's CacheHandler to determine if a request is expired and
 * should be refetched upon next request.
 *
 * The `Fetch` handler provided by `@ember-data/request/fetch` will automatically
 * add the `date` header to responses if it is not present.
 *
 * > [!NOTE]
 * > Date headers do not have millisecond precision, so expiration times should
 * > generally be larger than 1000ms.
 *
 * Usage:
 *
 * ```ts
 * import { CachePolicy } from '@ember-data/request-utils';
 * import DataStore from '@ember-data/store';
 *
 * // ...
 *
 * export class Store extends DataStore {
 *   constructor(args) {
 *     super(args);
 *     this.lifetimes = new CachePolicy({ apiCacheSoftExpires: 30_000, apiCacheHardExpires: 60_000 });
 *   }
 * }
 * ```
 *
 * In Testing environments, the `apiCacheSoftExpires` will always be `false`
 * and `apiCacheHardExpires` will use the `apiCacheSoftExpires` value.
 *
 * This helps reduce flakiness and produce predictably rendered results in test suites.
 *
 * Requests that specifically set `cacheOptions.backgroundReload = true` will
 * still be background reloaded in tests.
 *
 * This behavior can be opted out of by setting `disableTestOptimization = true`
 * in the policy config.
 *
 * @class CachePolicy
 * @public
 */
export class CachePolicy {
  declare config: PolicyConfig;
  declare _stores: WeakMap<
    Store,
    { invalidated: Set<StableDocumentIdentifier>; types: Map<string, Set<StableDocumentIdentifier>> }
  >;

  _getStore(store: Store): {
    invalidated: Set<StableDocumentIdentifier>;
    types: Map<string, Set<StableDocumentIdentifier>>;
  } {
    let set = this._stores.get(store);
    if (!set) {
      set = { invalidated: new Set(), types: new Map() };
      this._stores.set(store, set);
    }
    return set;
  }

  constructor(config: PolicyConfig) {
    this._stores = new WeakMap();

    const _config = arguments.length === 1 ? config : (arguments[1] as unknown as PolicyConfig);
    deprecate(
      `Passing a Store to the CachePolicy is deprecated, please pass only a config instead.`,
      arguments.length === 1,
      {
        id: 'ember-data:request-utils:lifetimes-service-store-arg',
        since: {
          enabled: '5.4',
          available: '4.13',
        },
        for: '@ember-data/request-utils',
        until: '6.0',
      }
    );
    assert(`You must pass a config to the CachePolicy`, _config);
    assert(`You must pass a apiCacheSoftExpires to the CachePolicy`, typeof _config.apiCacheSoftExpires === 'number');
    assert(`You must pass a apiCacheHardExpires to the CachePolicy`, typeof _config.apiCacheHardExpires === 'number');
    this.config = _config;
  }

  /**
   * Invalidate a request by its identifier for a given store instance.
   *
   * While the store argument may seem redundant, the CachePolicy
   * is designed to be shared across multiple stores / forks
   * of the store.
   *
   * ```ts
   * store.lifetimes.invalidateRequest(store, identifier);
   * ```
   *
   * @public
   * @param {StableDocumentIdentifier} identifier
   * @param {Store} store
   */
  invalidateRequest(identifier: StableDocumentIdentifier, store: Store): void {
    this._getStore(store).invalidated.add(identifier);
  }

  /**
   * Invalidate all requests associated to a specific type
   * for a given store instance.
   *
   * While the store argument may seem redundant, the CachePolicy
   * is designed to be shared across multiple stores / forks
   * of the store.
   *
   * This invalidation is done automatically when using this service
   * for both the CacheHandler and the LegacyNetworkHandler.
   *
   * ```ts
   * store.lifetimes.invalidateRequestsForType(store, 'person');
   * ```
   *
   * @public
   * @param {String} type
   * @param {Store} store
   */
  invalidateRequestsForType(type: string, store: Store): void {
    const storeCache = this._getStore(store);
    const set = storeCache.types.get(type);
    const notifications = store.notifications;

    if (set) {
      // TODO batch notifications
      set.forEach((id) => {
        storeCache.invalidated.add(id);
        notifications.notify(id, 'invalidated');
      });
    }
  }

  /**
   * Invoked when a request has been fulfilled from the configured request handlers.
   * This is invoked by the CacheHandler for both foreground and background requests
   * once the cache has been updated.
   *
   * Note, this is invoked by the CacheHandler regardless of whether
   * the request has a cache-key.
   *
   * This method should not be invoked directly by consumers.
   *
   * @public
   * @param {ImmutableRequestInfo} request
   * @param {ImmutableResponse} response
   * @param {Store} store
   * @param {StableDocumentIdentifier | null} identifier
   * @return {void}
   */
  didRequest(
    request: ImmutableRequestInfo,
    response: Response | ResponseInfo | null,
    identifier: StableDocumentIdentifier | null,
    store: Store
  ): void {
    // if this is a successful createRecord request, invalidate the cacheKey for the type
    if (request.op === 'createRecord') {
      const statusNumber = response?.status ?? 0;
      if (statusNumber >= 200 && statusNumber < 400) {
        const types = new Set(request.records?.map((r) => r.type));
        const additionalTypes = request.cacheOptions?.types;
        additionalTypes?.forEach((type) => {
          types.add(type);
        });

        types.forEach((type) => {
          this.invalidateRequestsForType(type, store);
        });
      }

      // add this document's cacheKey to a map for all associated types
      // it is recommended to only use this for queries
    } else if (identifier && request.cacheOptions?.types?.length) {
      const storeCache = this._getStore(store);
      request.cacheOptions?.types.forEach((type) => {
        const set = storeCache.types.get(type);
        if (set) {
          set.add(identifier);
          storeCache.invalidated.delete(identifier);
        } else {
          storeCache.types.set(type, new Set([identifier]));
        }
      });
    }
  }

  /**
   * Invoked to determine if the request may be fulfilled from cache
   * if possible.
   *
   * Note, this is only invoked by the CacheHandler if the request has
   * a cache-key.
   *
   * If no cache entry is found or the entry is hard expired,
   * the request will be fulfilled from the configured request handlers
   * and the cache will be updated before returning the response.
   *
   * @public
   * @param {StableDocumentIdentifier} identifier
   * @param {Store} store
   * @return {Boolean} true if the request is considered hard expired
   */
  isHardExpired(identifier: StableDocumentIdentifier, store: Store): boolean {
    // if we are explicitly invalidated, we are hard expired
    const storeCache = this._getStore(store);
    if (storeCache.invalidated.has(identifier)) {
      return true;
    }
    const cache = store.cache;
    const cached = cache.peekRequest(identifier);

    if (!cached?.response) {
      if (LOG_CACHE_POLICY) {
        // eslint-disable-next-line no-console
        console.log(`CachePolicy: ${identifier.lid} is EXPIRED because no cache entry was found`);
      }
      return true;
    }

    return isExpired(identifier, cached, this.config);
  }

  /**
   * Invoked if `isHardExpired` is false to determine if the request
   * should be update behind the scenes if cache data is already available.
   *
   * Note, this is only invoked by the CacheHandler if the request has
   * a cache-key.
   *
   * If true, the request will be fulfilled from cache while a backgrounded
   * request is made to update the cache via the configured request handlers.
   *
   * @public
   * @param {StableDocumentIdentifier} identifier
   * @param {Store} store
   * @return {Boolean} true if the request is considered soft expired
   */
  isSoftExpired(identifier: StableDocumentIdentifier, store: Store): boolean {
    if (TESTING) {
      if (!this.config.disableTestOptimization) {
        return false;
      }
    }
    const cache = store.cache;
    const cached = cache.peekRequest(identifier);

    if (cached?.response) {
      const date = cached.response.headers.get('date');

      if (!date) {
        if (LOG_CACHE_POLICY) {
          // eslint-disable-next-line no-console
          console.log(`CachePolicy: ${identifier.lid} is STALE because no date header was found`);
        }
        return true;
      } else {
        const time = new Date(date).getTime();
        const now = Date.now();
        const deadline = time + this.config.apiCacheSoftExpires;
        const result = now >= deadline;

        if (LOG_CACHE_POLICY) {
          // eslint-disable-next-line no-console
          console.log(
            `CachePolicy: ${identifier.lid} is ${result ? 'STALE' : 'NOT stale'}. Expiration time: ${deadline}, now: ${now}`
          );
        }

        return result;
      }
    }

    if (LOG_CACHE_POLICY) {
      // eslint-disable-next-line no-console
      console.log(`CachePolicy: ${identifier.lid} is STALE because no cache entry was found`);
    }

    return true;
  }
}

export class LifetimesService extends CachePolicy {
  constructor(config: PolicyConfig) {
    deprecate(
      `\`import { LifetimesService } from '@ember-data/request-utils';\` is deprecated, please use \`import { CachePolicy } from '@ember-data/request-utils';\` instead.`,
      false,
      {
        id: 'ember-data:deprecate-lifetimes-service-import',
        since: {
          enabled: '5.4',
          available: '4.13',
        },
        for: 'ember-data',
        until: '6.0',
      }
    );
    super(config);
  }
}

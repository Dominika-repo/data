import type { IdentifierBucket, StableIdentifier, StableRecordIdentifier } from '../../../types/identifier.ts';
import type { ImmutableRequestInfo } from '../../../types/request.ts';

/**
  Configures how unique identifier lid strings are generated by @ember-data/store.

  This configuration MUST occur prior to the store instance being created.

  Takes a method which can expect to receive various data as its first argument
  and the name of a bucket as its second argument.

  Currently there are two buckets, 'record' and 'document'.

  ### Resource (`Record`) Identity

  If the bucket is `record` the method must return a unique (to at-least
  the given bucket) string identifier for the given data as a string to be
  used as the `lid` of an `Identifier` token.

  This method will only be called by either `getOrCreateRecordIdentifier` or
  `createIdentifierForNewRecord` when an identifier for the supplied data
  is not already known via `lid` or `type + id` combo and one needs to be
  generated or retrieved from a proprietary cache.

  `data` will be the same data argument provided to `getOrCreateRecordIdentifier`
  and in the `createIdentifierForNewRecord` case will be an object with
  only `type` as a key.

  ```ts
  import { setIdentifierGenerationMethod } from '@ember-data/store';

  export function initialize(applicationInstance) {
    // note how `count` here is now scoped to the application instance
    // for our generation method by being inside the closure provided
    // by the initialize function
    let count = 0;

    setIdentifierGenerationMethod((resource, bucket) => {
      return resource.lid || `my-key-${count++}`;
    });
  }

  export default {
    name: 'configure-ember-data-identifiers',
    initialize
  };
  ```

  ### Document Identity

  If the bucket is `document` the method will receive the associated
  immutable `request` passed to `store.request` as its first argument
  and should return a unique string for the given request if the document
  should be cached, and `null` if it should not be cached.

  Note, the request result will still be passed to the cache via `Cache.put`,
  but caches should take this as a signal that the document should not itself
  be cached, while its contents may still be used to update other cache state.

  The presence of `cacheOptions.key` on the request will take precedence
  for the document cache key, and this method will not be called if it is
  present.

  The default method implementation for this bucket is to return `null`
  for all requests whose method is not `GET`, and to return the `url` for
  those where it is.

  This means that queries via `POST` MUST provide `cacheOptions.key` or
  implement this hook.

  ⚠️ Caution: Requests that do not have a `method` assigned are assumed to be `GET`

  @param method
  @public
*/
export interface GenerationMethod {
  (data: ImmutableRequestInfo, bucket: 'document'): string | null;
  (data: unknown | { type: string }, bucket: 'record'): string;
  (data: unknown, bucket: IdentifierBucket): string | null;
}

/**
 Configure a callback for when the identifier cache encounters new resource
 data for an existing resource.

 This configuration MUST occur prior to the store instance being created.

 ```js
 import { setIdentifierUpdateMethod } from '@ember-data/store';
 ```

 Takes a method which can expect to receive an existing `Identifier` alongside
 some new data to consider as a second argument. This is an opportunity
 for secondary lookup tables and caches associated with the identifier
 to be amended.

 This method is called everytime `updateRecordIdentifier` is called and
  with the same arguments. It provides the opportunity to update secondary
  lookup tables for existing identifiers.

 It will always be called after an identifier created with `createIdentifierForNewRecord`
  has been committed, or after an update to the `record` a `RecordIdentifier`
  is assigned to has been committed. Committed here meaning that the server
  has acknowledged the update (for instance after a call to `.save()`)

 If `id` has not previously existed, it will be assigned to the `Identifier`
  prior to this `UpdateMethod` being called; however, calls to the parent method
  `updateRecordIdentifier` that attempt to change the `id` or calling update
  without providing an `id` when one is missing will throw an error.

  @param method
  @public
*/

export type UpdateMethod = {
  (identifier: StableRecordIdentifier, newData: unknown, bucket: 'record'): void;
  (identifier: StableIdentifier, newData: unknown, bucket: never): void;
};

/**
 Configure a callback for when the identifier cache is going to release an identifier.

 This configuration MUST occur prior to the store instance being created.

 ```js
 import { setIdentifierForgetMethod } from '@ember-data/store';
 ```

 Takes method which can expect to receive an existing `Identifier` that should be eliminated
 from any secondary lookup tables or caches that the user has populated for it.

  @param method
  @public
*/
export type ForgetMethod = (identifier: StableIdentifier | StableRecordIdentifier, bucket: IdentifierBucket) => void;

/**
 Configure a callback for when the identifier cache is being torn down.

 This configuration MUST occur prior to the store instance being created.

 ```js
 import { setIdentifierResetMethod } from '@ember-data/store';
 ```

 Takes a method which can expect to be called when the parent application is destroyed.

 If you have properly used a WeakMap to encapsulate the state of your customization
 to the application instance, you may not need to implement the `resetMethod`.

  @param method
  @public
*/
export type ResetMethod = () => void;

/**
 Configure a callback for when the identifier cache is generating a new
 StableRecordIdentifier for a resource.

 This method controls the `type` and `id` that will be assigned to the
 `StableRecordIdentifier` that is created.

 This configuration MUST occur prior to the store instance being created.

 ```js
 import { setKeyInfoForResource } from '@ember-data/store';
 ```

  @param method
  @public
 */
export type KeyInfo = {
  id: string | null;
  type: string;
};
export type KeyInfoMethod = (resource: unknown, known: StableRecordIdentifier | null) => KeyInfo;

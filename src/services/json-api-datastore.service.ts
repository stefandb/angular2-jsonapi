///<reference path="../../node_modules/@angular/http/src/base_request_options.d.ts"/>
import { Injectable } from '@angular/core';
import { Headers, Http, RequestOptions, Response } from '@angular/http';
import find from 'lodash-es/find';
import { Observable } from 'rxjs/Observable';
import { ErrorObservable } from 'rxjs/observable/ErrorObservable';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/catch';
import 'rxjs/add/observable/throw';
import 'rxjs/add/observable/of';
import { JsonApiModel } from '../models/json-api.model';
import { ErrorResponse } from '../models/error-response.model';
import { JsonApiQueryData } from '../models/json-api-query-data';
import * as qs from 'qs';
import { DatastoreConfig } from '../interfaces/datastore-config.interface';
import { ModelConfig } from '../interfaces/model-config.interface';
import { AttributeMetadata } from '../constants/symbols';

export type ModelType<T extends JsonApiModel> = { new(datastore: JsonApiDatastore, data: any): T; };

@Injectable()
export class JsonApiDatastore {
  // tslint:disable:variable-name
  private _headers: Headers;
  private _store: {[type: string]: {[id: string]: JsonApiModel}} = {};
  // tslint:disable:max-line-length
  private getDirtyAttributes: Function = this.datastoreConfig.overrides && this.datastoreConfig.overrides.getDirtyAttributes ? this.datastoreConfig.overrides.getDirtyAttributes : this._getDirtyAttributes;
  private toQueryString: Function = this.datastoreConfig.overrides && this.datastoreConfig.overrides.toQueryString ? this.datastoreConfig.overrides.toQueryString : this._toQueryString;
  // tslint:enable:max-line-length

  protected config: DatastoreConfig;

  constructor(protected http: Http) {}

  /** @deprecated - use findAll method to take all models **/
  query<T extends JsonApiModel>(
    modelType: ModelType<T>,
    params?: any,
    headers?: Headers,
    customUrl?: string
  ): Observable<T[]> {
    const options: RequestOptions = this.getOptions(headers);
    const url: string = this.buildUrl(modelType, params, undefined, customUrl);
    return this.http.get(url, options)
      .map((res: any) => this.extractQueryData(res, modelType))
      .catch((res: any) => this.handleError(res));
  }

  findAll<T extends JsonApiModel>(
    modelType: ModelType<T>,
    params?: any,
    headers?: Headers,
    customUrl?: string
  ): Observable<JsonApiQueryData<T>> {
    const options: RequestOptions = this.getOptions(headers);
    const url: string = this.buildUrl(modelType, params, undefined, customUrl);

    return this.http.get(url, options)
      .map((res: any) => this.extractQueryData(res, modelType, true))
      .catch((res: any) => this.handleError(res));
  }

  findRecord<T extends JsonApiModel>(
    modelType: ModelType<T>,
    id: string,
    params?: any,
    headers?: Headers,
    customUrl?: string
  ): Observable<T> {
    const options: RequestOptions = this.getOptions(headers);
    const url: string = this.buildUrl(modelType, params, id, customUrl);

    return this.http.get(url, options)
      .map((res) => this.extractRecordData(res, modelType))
      .catch((res: any) => this.handleError(res));
  }

  createRecord<T extends JsonApiModel>(modelType: ModelType<T>, data?: any): T {
    return new modelType(this, { attributes: data });
  }

  private _getDirtyAttributes(attributesMetadata: any): { string: any} {
    const dirtyData: any = {};

    for (const propertyName in attributesMetadata) {
      if (attributesMetadata.hasOwnProperty(propertyName)) {
        const metadata: any = attributesMetadata[propertyName];

        if (metadata.hasDirtyAttributes) {
          const attributeName = metadata.serializedName != null ? metadata.serializedName : propertyName;
          dirtyData[attributeName] = metadata.serialisationValue ? metadata.serialisationValue : metadata.newValue;
        }
      }
    }
    return dirtyData;
  }

  saveBulk<T extends JsonApiModel>(
    items: Array<any>,
    model: T,
    params?: any,
    headers?: Headers,
    customUrl?: string
  ): Observable<any> {

    // tslint:disable-next-line:no-param-reassign
    const that = this;
    const modelType = <ModelType<T>>model.constructor;
    const url = this.buildUrl(modelType, params, undefined, customUrl);
    let customHeaders = new Headers();
    if (headers !== undefined) customHeaders = headers;
    customHeaders.set('Accept', 'application/vnd.api+json; ext=bulk');
    customHeaders.set('Accept-Type', 'application/vnd.api+json; ext=bulk');
    const options = this.getOptions(customHeaders);
    const patchData: Array<any> = [];
    const postData: Array<any> = [];

    items.forEach(function (item) {
      const modelConfig = model.modelConfig;
      const relationships = that.getRelationships(item);
      const typeName = modelConfig.type;

      const body = {
        relationships,
        type: typeName,
        id: item.id,
        attributes: this._getDirtyAttributes(item.getAttributeMetadata())
      };

      if (!item.id) {
        postData.push(body);
      } else {
        patchData.push(body);
      }
    });

    const fullBody = { POST: { data: postData }, PATCH: { data: patchData } };

    const findPostPrediction = function (fixtureId: number) {
      let foundItem = null;
      items.forEach(function (itemData) {
        if (itemData.fixture_id === fixtureId) {
          foundItem = itemData;
        }
      });
      return foundItem;
    };

    return this.http.post(url, fullBody, options)
      .map(function (res) {
        const result: any[T] = [];
        const body = res.json();

        if (body.hasOwnProperty('PATCH')) {
          if (body.PATCH.data.length > 0) {
            this.extractQueryDataBulk(body.PATCH, modelType, true).forEach( function(singleItem: any) {
              result.push(singleItem);
            });
          }
        }

        if (body.hasOwnProperty('POST')) {
          if (body.POST.data.length > 0) {
            body.POST.data.forEach(function (item: any) {
              result.push(
                this.extractRecordDataFromBulk(
                  item,
                  modelType,
                  findPostPrediction(item.attributes.fixture_id)
                )
              );
            });
          }
        }

        return result;
      })
      .catch(function (res) {
        if (res == null) {
          return Observable.of(model);
        }

        return this.handleError(res);
      });
  }

  saveRecord<T extends JsonApiModel>(
    attributesMetadata: any,
    model: T,
    params?: any,
    headers?: Headers,
    customUrl?: string
  ): Observable<T> {
    const modelType = <ModelType<T>>model.constructor;
    const modelConfig: ModelConfig = model.modelConfig;
    const typeName: string = modelConfig.type;
    const options: RequestOptions = this.getOptions(headers);
    const relationships: any = this.getRelationships(model);
    const url: string = this.buildUrl(modelType, params, model.id, customUrl);

    let httpCall: Observable<Response>;
    const body: any = {
      data: {
        relationships,
        type: typeName,
        id: model.id,
        attributes: this.getDirtyAttributes(attributesMetadata)
      }
    };

    if (model.id) {
      httpCall = this.http.patch(url, body, options);
    } else {
      httpCall = this.http.post(url, body, options);
    }

    return httpCall
      .map((res) => res.status === 201 ? this.extractRecordData(res, modelType, model) : model)
      .catch((res) => {
        if (res == null) {
          return Observable.of(model);
        }

        return this.handleError(res);
      })
      .map((res) => this.resetMetadataAttributes(res, attributesMetadata, modelType))
      .map((res) => this.updateRelationships(res, relationships));
  }



  deleteRecord<T extends JsonApiModel>(
    modelType: ModelType<T>,
    id: string,
    headers?: Headers,
    customUrl?: string
  ): Observable<Response> {
    const options: RequestOptions = this.getOptions(headers);
    const url: string = this.buildUrl(modelType, null, id, customUrl);

    return this.http.delete(url, options).catch((res: any) => this.handleError(res));
  }

  peekRecord<T extends JsonApiModel>(modelType: ModelType<T>, id: string): T | null {
    const type: string = Reflect.getMetadata('JsonApiModelConfig', modelType).type;
    return this._store[type] ? <T>this._store[type][id] : null;
  }

  peekAll<T extends JsonApiModel>(modelType: ModelType<T>): T[] {
    const type = Reflect.getMetadata('JsonApiModelConfig', modelType).type;
    const typeStore = this._store[type];
    return typeStore ? Object.keys(typeStore).map((key) => <T>typeStore[key]) : [];
  }

  set headers(headers: Headers) {
    this._headers = headers;
  }

  protected buildUrl<T extends JsonApiModel>(
    modelType: ModelType<T>,
    params?: any,
    id?: string,
    customUrl?: string
  ): string {
    const queryParams: string = this.toQueryString(params);

    if (customUrl) {
      return queryParams ? `${customUrl}?${queryParams}` : customUrl;
    }

    const modelConfig: ModelConfig = Reflect.getMetadata('JsonApiModelConfig', modelType);

    const baseUrl = modelConfig.baseUrl || this.datastoreConfig.baseUrl;
    const apiVersion = modelConfig.apiVersion || this.datastoreConfig.apiVersion;
    const modelEndpointUrl: string = modelConfig.modelEndpointUrl || modelConfig.type;

    const url: string = [baseUrl, apiVersion, modelEndpointUrl, id].filter((x) => x).join('/');

    return queryParams ? `${url}?${queryParams}` : url;
  }

  protected getRelationships(data: any): any {
    let relationships: any;

    for (const key in data) {
      if (data.hasOwnProperty(key)) {
        if (data[key] instanceof JsonApiModel) {
          relationships = relationships || {};

          if (data[key].id) {
            relationships[key] = {
              data: this.buildSingleRelationshipData(data[key])
            };
          }
        } else if (data[key] instanceof Array && data[key].length > 0 && this.isValidToManyRelation(data[key])) {
          relationships = relationships || {};

          const relationshipData = data[key]
            .filter((model: JsonApiModel) => model.id)
            .map((model: JsonApiModel) => this.buildSingleRelationshipData(model));

          relationships[key] = {
            data: relationshipData
          };
        }
      }
    }

    return relationships;
  }

  protected isValidToManyRelation(objects: Array<any>): boolean {
    const isJsonApiModel = objects.every((item) => item instanceof JsonApiModel);
    const relationshipType: string = isJsonApiModel ? objects[0].modelConfig.type : '';

    return isJsonApiModel ? objects.every((item: JsonApiModel) => item.modelConfig.type === relationshipType) : false;
  }

  protected buildSingleRelationshipData(model: JsonApiModel): any {
    const relationshipType: string = model.modelConfig.type;
    const relationShipData: { type: string, id?: string, attributes?: any } = { type: relationshipType };

    if (model.id) {
      relationShipData.id = model.id;
    } else {
      const attributesMetadata: any = Reflect.getMetadata('Attribute', model);
      relationShipData.attributes = this.getDirtyAttributes(attributesMetadata);
    }

    return relationShipData;
  }

  protected extractQueryDataBulk<T extends JsonApiModel> (
    res: any,
    modelType: ModelType<T>,
    withMeta = false
  ) {
    const models: any[T] = [];
    res.data.forEach(function (data: any) {
      const model = this.deserializeModel(modelType, data);
      this.addToStore(model);
      if (res.included) {
        model.syncRelationships(data, res.included, 0);
        this.addToStore(model);
      }
      models.push(model);
    });
    return models;
  }

  protected extractQueryData<T extends JsonApiModel>(
    res: any,
    modelType: ModelType<T>,
    withMeta = false
  ): T[] | JsonApiQueryData<T> {
    const body: any = res.json();
    const models: T[] = [];

    body.data.forEach((data: any) => {
      const model: T = this.deserializeModel(modelType, data);
      this.addToStore(model);

      if (body.included) {
        model.syncRelationships(data, body.included, 0);
        this.addToStore(model);
      }

      models.push(model);
    });

    if (withMeta && withMeta === true) {
      return new JsonApiQueryData(models, this.parseMeta(body, modelType));
    } else {
      return models;
    }
  }

  protected deserializeModel<T extends JsonApiModel>(modelType: ModelType<T>, data: any) {
    data.attributes = this.transformSerializedNamesToPropertyNames(modelType, data.attributes);
    return new modelType(this, data);
  }

  protected extractRecordDataFromBulk<T extends JsonApiModel>(res: any, modelType: ModelType<T>, model?: T): T {
    if (model) {
      model.id = res.id;
      Object.assign(model, res.attributes);
    }

    // tslint:disable-next-line:no-param-reassign
    model = model || this.deserializeModel(modelType, res.data);
    this.addToStore(model);
    if (res.included) {
      model.syncRelationships(res, res.included, 0);
      this.addToStore(model);
    }
    return model;
  }

  protected extractRecordData<T extends JsonApiModel>(res: Response, modelType: ModelType<T>, model?: T): T {
    const body: any = res.json();

    if (!body) {
      throw new Error('no body in response');
    }

    if (model) {
      model.id = body.data.id;
      Object.assign(model, body.data.attributes);
    }

    // tslint:disable-next-line:no-param-reassign
    model = model || this.deserializeModel(modelType, body.data);

    this.addToStore(model);
    if (body.included) {
      model.syncRelationships(body.data, body.included, 0);
      this.addToStore(model);
    }

    return model;
  }

  protected handleError(error: any): ErrorObservable {
    // tslint:disable-next-line:max-line-length
    const errMsg: string = (error.message) ? error.message : error.status ? `${error.status} - ${error.statusText}` : 'Server error';

    try {
      const body: any = error.json();

      if (body.errors && body.errors instanceof Array) {
        const errors: ErrorResponse = new ErrorResponse(body.errors);
        console.error(errMsg, errors);
        return Observable.throw(errors);
      }
    } catch (e) {
        // no valid JSON
    }

    console.error(errMsg);
    return Observable.throw(errMsg);
  }

  protected parseMeta(body: any, modelType: ModelType<JsonApiModel>): any {
    const metaModel: any = Reflect.getMetadata('JsonApiModelConfig', modelType).meta;
    return new metaModel(body);
  }

  protected getOptions(customHeaders?: Headers): RequestOptions {
    const requestHeaders = new Headers();

    requestHeaders.set('Accept', 'application/vnd.api+json');
    requestHeaders.set('Content-Type', 'application/vnd.api+json');
    if (this._headers) {
      this._headers.forEach((values, name) => {
        if (name !== undefined) {
          requestHeaders.set(name, values);
        }
      });
    }

    if (customHeaders) {
      customHeaders.forEach((values, name) => {
        if (name !== undefined) {
          requestHeaders.set(name, values);
        }
      });
    }

    return new RequestOptions({ headers: requestHeaders });
  }

  private _toQueryString(params: any): string {
    return qs.stringify(params, { arrayFormat: 'brackets' });
  }

  public addToStore(modelOrModels: JsonApiModel | JsonApiModel[]): void {
    const models = Array.isArray(modelOrModels) ? modelOrModels : [modelOrModels];
    const type: string = models[0].modelConfig.type;
    let typeStore = this._store[type];

    if (!typeStore) {
      typeStore = this._store[type] = {};
    }

    for (const model of models) {
      typeStore[model.id] = model;
    }
  }

  protected resetMetadataAttributes<T extends JsonApiModel>(res: T, attributesMetadata: any, modelType: ModelType<T>) {
    // TODO check why is attributesMetadata from the arguments never used
    // tslint:disable-next-line:no-param-reassign
    attributesMetadata = res[AttributeMetadata];

    for (const propertyName in attributesMetadata) {
      if (attributesMetadata.hasOwnProperty(propertyName)) {
        const metadata: any = attributesMetadata[propertyName];

        if (metadata.hasDirtyAttributes) {
          metadata.hasDirtyAttributes = false;
        }
      }
    }

    res[AttributeMetadata] = attributesMetadata;
    return res;
  }

  protected updateRelationships<T extends JsonApiModel>(model: T, relationships: any): T {
    const modelsTypes: any = Reflect.getMetadata('JsonApiDatastoreConfig', this.constructor).models;

    for (const relationship in relationships) {
      if (relationships.hasOwnProperty(relationship) && model.hasOwnProperty(relationship)) {
        const relationshipModel: JsonApiModel = model[relationship];
        const hasMany: any[] = Reflect.getMetadata('HasMany', relationshipModel);
        const propertyHasMany: any = find(hasMany, (property) => {
          return modelsTypes[property.relationship] === model.constructor;
        });

        if (propertyHasMany) {
          relationshipModel[propertyHasMany.propertyName] = relationshipModel[propertyHasMany.propertyName] || [];

          const indexOfModel = relationshipModel[propertyHasMany.propertyName].indexOf(model);

          if (indexOfModel === -1) {
            relationshipModel[propertyHasMany.propertyName].push(model);
          } else {
            relationshipModel[propertyHasMany.propertyName][indexOfModel] = model;
          }
        }
      }
    }

    return model;
  }

  protected get datastoreConfig(): DatastoreConfig {
    const configFromDecorator: DatastoreConfig = Reflect.getMetadata('JsonApiDatastoreConfig', this.constructor);
    return Object.assign(configFromDecorator, this.config);
  }

  protected transformSerializedNamesToPropertyNames<T extends JsonApiModel>(modelType: ModelType<T>, attributes: any) {
    const serializedNameToPropertyName = this.getModelPropertyNames(modelType.prototype);
    const properties: any = {};

    Object.keys(serializedNameToPropertyName).forEach((serializedName) => {
      if (attributes[serializedName] !== null && attributes[serializedName] !== undefined) {
        properties[serializedNameToPropertyName[serializedName]] = attributes[serializedName];
      }
    });

    return properties;
  }

  protected getModelPropertyNames(model: JsonApiModel) {
    return Reflect.getMetadata('AttributeMapping', model);
  }
}

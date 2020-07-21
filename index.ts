 
/*external modules*/
import assert from 'assert';
import _ from "lodash";
/*DB*/
/*other*/
import { TArray } from '@honey/types'
import {ServerError} from "../../app/error";

export namespace Test {
  export class CheckS<TResult> {
    private static keyProperties = ['$value', '$check', '$func', '$eMessage'];

    private static createErrors(
      field: string,
      value: any,
      valueInResult: any,
      stackPaths?: string[]
    ): { stackError: string; errorMessage: string } {
      let errorMessage;

      let stackError = field;
      if (!_.isEmpty(stackPaths)) {
        stackError = stackPaths?.join('.') + '.' + stackError;
      }

      if (_.has(value, '$eMessage')) {
        errorMessage = _.isFunction(value.eMessage)?value.eMessage(valueInResult, value) : value.eMessage;
      } else {
        errorMessage = `Incorrect "${stackError}"`;
      }

      return {
        stackError,
        errorMessage
      };
    }

    private static getValue(
      field: string,
      result: any,
      data: any,
      stackPaths?: string[]
    ): { value: any; valueInResult: any } {
      const value = _.get(data, field);
      let valueInResult;

      if (_.isArray(result)) {
        if (!_.isNaN(Number(field))) {
          valueInResult = _.nth(result, Number(field));
        } else {
          throw new Error(
            `"${_.last(stackPaths)}" is array. You must use numbers for arrays.`
          );
        }
      } else {
        valueInResult = _.get(result, field);
      }

      return {
        value,
        valueInResult
      };
    }

    private static equal<T>(options: {
      assertFunction: Function;
      data: any;
      resultRecursive?: any;
      stackPaths?: string[];
    }) {
      const { data, resultRecursive, assertFunction, stackPaths } = options;

      const result = resultRecursive || this.result;

      Object.keys(data).forEach(field => {
        const { value, valueInResult } = Check.getValue(
          field,
          result,
          data,
          stackPaths
        );

        const { stackError, errorMessage } = Check.createErrors(
          field,
          value,
          valueInResult,
          stackPaths
        );

        if (_.isUndefined(valueInResult)) {
          throw new GraphQLError(
            `"${stackError}" Not Found. See GraphQL query schema.`
          );
        }

        if (_.isObject(value as any)) {
          if (_.has(value, 'data')) {
            if (_.isUndefined(value.data)) {
              throw new GraphQLError(
                `Your "data" in "${stackError}" is undefined`
              );
            }

            const actual = _.has(value, 'func')
              ? value.func(valueInResult)
              : valueInResult;
            const expected = _.has(value, 'func')
              ? value.func(value.data)
              : value.data;

            assertFunction(actual, expected, errorMessage);
          } else {
            this.equal({
              data: value,
              resultRecursive: valueInResult,
              stackPaths: _.isEmpty(stackPaths)
                ? [field]
                : stackPaths?.concat(field),
              assertFunction
            });
          }
        } else {
          if (_.isUndefined(value)) {
            throw new GraphQLError(`Your "${stackError}" is undefined`);
          }

          assertFunction(valueInResult, value, errorMessage);
        }
      });
    }

    private someOrEvery(data: any, lodashCheckFunction: Function) {
      Object.keys(data).forEach(field => {
        const valueInResult = _.get(this.result, field);
        const checkFunction = _.get(data, field);

        if (!_.isArray(valueInResult)) {
          throw new GraphQLError(`${field} is not array`);
        }
        if (!_.isFunction(checkFunction)) {
          throw new GraphQLError(`${field} is not a function`);
        }

        assert.ok(
          lodashCheckFunction(valueInResult, checkFunction),
          `Incorrect ${field}.`
        );
      });
    }

    private forEachInCheckData(data: any){
      Object
        .keys(data)
        .forEach(key => {
          const arrayValueInResult = _.get(this.result, key);
          const dataToCheck = _.get(data, key)

          if(!_.isArray(arrayValueInResult)) throw new GraphQLError(`${key} must be array.`)

          this.saveResult(arrayValueInResult);

          _.forEach(arrayValueInResult, valueInResult => {
            this.result = valueInResult
            this.check(dataToCheck)
          })

          this.deleteSavedResult()
        })

      return this
    }

    private compare(operator: string, actual: any, expected: any, errorMessage: string){
      switch (operator) {
        case '===':
          assert.ok(actual === expected, errorMessage)
          break;
        case '==':
          assert.ok(actual == expected, errorMessage)
          break;
        case '!==':
          assert.ok(actual !== expected, errorMessage)
          break;
        case '!=':
          assert.ok(actual != expected, errorMessage)
          break;
        case '>=':
          assert.ok(actual >= expected, errorMessage)
          break;
        case '<=':
          assert.ok(actual <= expected, errorMessage)
          break;
        case '<':
          assert.ok(actual < expected, errorMessage)
          break;
        case '>':
          assert.ok(actual > expected, errorMessage)
          break;
        default:
          throw new Error(`Undefined operator: "${operator}".`)
      }
    }

    check<T>(data: T, dataToCheck: TCheck) {
      Object.keys(dataToCheck).forEach(key => {
        switch (key) {
          case 'equal':
            this.equal({
              assertFunction: assert.equal.bind(assert),
              data: dataToCheck[key]
            });
            break;
          case 'strictEqual':
            this.equal({
              assertFunction: assert.strictEqual.bind(assert),
              data: strictEqual
            });
            break;
          case 'notEqual':
            this.equal({
              assertFunction: assert.notEqual.bind(assert),
              data: notEqual
            });
            break;
          case 'some':
            this.someOrEvery(some, _.some.bind(_));
            break;
          case 'every':
            this.someOrEvery(every, _.every.bind(_));
            break;
          case 'forEach':
            this.forEachInCheckData(forEach);
            break;
          case 'operator':
            Object
              .keys(operators)
              .forEach(op => {
                console.log('data', operators[op])

                this.equal({
                  assertFunction: this.comparison.bind(this, op),
                  data: operators[op]
                });
              })
            break;
          case 'result':
            if(!_.isFunction(result)) throw new GraphQLError('"result" in dataToCheck mat be function.')
            result(this.result);
            break;
          default:
            throw new GraphQLError(`${key} not supported.`)
        }
      });
    }

    forEach(dataToCheck: TCheck){
      if(!_.isArray(this.result)) throw new Error('"result" is not array. Please use method "check".')

      // const arrayResult = this.result;

      _.forEach(data, singleResult => {
        // this.result = singleResult;
        this.check(singleResult, dataToCheck)
      })

      // this.result = arrayResult

      return this
    }
  }

  type CheckKeys = 'equal' | 'notEqual' | 'some' | 'every' | 'forEach' | 'operator'
  type TCheckObject<TObject> =
    | {
      [TPath in keyof TObject]:
        TObject[TPath] extends Array<infer TArrayItem>
          ? | {
            [TKey in number]?: TCheckObject<TObject[TPath][TKey]>
          }
          : ''
    }
    | {
      [x: string]: any;
    }

  type TCheckTemplate<TData> = {
    [TKey in CheckKeys]: TCheckObject<TData>
  }

  type TCheck<TData> = TData extends Array<infer TValue>
    ? { (value: TValue): TCheckObject<TValue> } | TCheckObject<TValue>
    : TCheckObject<TData>;

  class ClassCheck {
    private static keyProperties = ['$value', '$check', '$func', '$eMessage'];

    private static equal() {

    }

    private static check<TData>(data: TData, dataToCheck: TCheckObject<TData>) {
      Object
        .keys(dataToCheck)
        .forEach((key: CheckKeys | string) => {
          
          const dataForCheck = dataToCheck[key];
          switch (key) {
            case 'equal': {
              break;
            }
            case 'notEqual': {
              break;
            }
            case 'some': {
              break;
            }
            case 'every': {
              break;
            }
            case 'forEach': {
              break;
            }
            case 'operator': {
              break
            }
            default:
              throw new ServerError(`${key} not supported.`)
          }
        })
    }

    static data<TData, TFields = keyof TData>(
      data: TArray.PossibleArray<TData>,
      dataToCheck: TCheck<TArray.PossibleArray<TData>>
    ) {
      if(!data) throw ServerError.notFound('data')

      if (data instanceof Array) {
        return data.forEach(data => {
          if (_.isFunction(dataToCheck)) {
            ClassCheck.check(data, dataToCheck(data));
          } else {
            ClassCheck.check(data, dataToCheck);
          }
        });
      }

      if (_.isFunction(dataToCheck)) {
        throw new ServerError(
          `"data" is not array. The second parameter should be an object.`
        );
      }

      return ClassCheck.check(data, dataToCheck);
    }
  }

  ClassCheck.data(
    {
      a: 5
    }, {
      equal: {
        a:
      }
    }
  )
}


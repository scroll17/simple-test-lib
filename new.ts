import _ from 'lodash';
import assert from 'assert';
import pino from 'pino';
import moment from 'moment';

const config: any = {}

const logger = pino({
  name: config.name,
  level: config.logger.level,
  prettyPrint: config.logger.pretty && {
    forceColor: true
    // translateTime: 'HH:MM:ss',
    // ignore: 'pid,hostname'
  }
});


type TFieldSet<TData, TFields = Array<keyof TData>> = {
  scalar?: TFields;
  object?: TFields;
  array?: TFields;
};

type TPrimitive = string | number | symbol | boolean | null | undefined;

type TCheckPrimitive<TValue> =
  | string
  | number
  | symbol
  | boolean
  | {
  $check: '==' | '===' | '!==' | '!=' | '>=' | '<=' | '<' | '>' | 'equal' | 'notEqual' | 'strictEqual';
  $value: TPrimitive;
  $func?: (value: TValue) => TPrimitive;
  $eMessage?: ((valueInData: TValue, value: TPrimitive) => string) | string;
};

type TCheckObject<TObject> =
  | {
      [TPath in keyof TObject]?: TObject[TPath] extends Array<infer TArrayItem>
      ?
        | {
          [TKey in number]?: TCheckObject<TObject[TPath][TKey]> | TCheckPrimitive<TObject[TPath][TKey]>;
        }
        | ({ $check: 'forEach' } & (TArrayItem extends TPrimitive ? never : TCheckObject<TArrayItem>))
        | {
          $check: 'some' | 'every';
          $value: (value: TArrayItem) => boolean;
          $eMessage?: string;
        }
      : TObject[TPath] extends TPrimitive | Date
        ? TCheckPrimitive<TObject[TPath]>
          : TObject[TPath] extends Record<string, any>
            ? TCheckObject<TObject[TPath]>
            : TCheckPrimitive<TObject[TPath]>;
    }
  | {
      [x: string]: any;
  };

type TCheck<TData> = TData extends Array<infer TValue>
  ? { (value: TValue): TCheckObject<TValue> } | TCheckObject<TValue>
  : TCheckObject<TData>;

class Check {
  private static keyProperties = ['$value', '$check', '$func', '$eMessage'];

  public static noErrors<TGQLError>(
    errors: readonly TGQLError[] | undefined,
    logLevel?: 'debug' | 'warn' | 'error'
  ): void {
    if (errors && logLevel && _.isFunction(logger[logLevel])) {
      _.map(errors, error => {
        logger[logLevel](`there should be no error: "${error}"`);
      });
    }

    assert.ok(!errors, 'there should be no errors: ' + JSON.stringify(errors));
  }

  public static error<TGQLErrors>(errors: TGQLErrors, desiredError: Error): void {
    if (!errors) throw Error(`Not found errors`);

    assert.equal(
      _.isArray(errors) ? _.get(errors, [0, 'message']) : _.get(errors, 'message'),
      _.get(desiredError, 'message'),
      `there should be error: "${desiredError.message}"`
    );
  }

  public static requiredFields<TData, TPath extends keyof TData>(
    requiredFieldSet: TFieldSet<TData>,
    data: TData,
    path: TPath | '' = ''
  ): void | never {
    _.chain(requiredFieldSet)
      .keys()
      .value()
      .forEach(key => {
        let verifyFunction: (key: any) => boolean;
        let errorMessage: string;
        switch (key) {
          case 'scalar':
            verifyFunction = value => !_.isNil(value);
            errorMessage = `it should return`;
            break;
          case 'object':
            verifyFunction = value => !_.isEmpty(value);
            errorMessage = `it should be not empty`;
            break;
          case 'array':
            verifyFunction = _.isArray.bind(_);
            errorMessage = `it should be array`;
            break;
        }
        _.forEach(_.get(requiredFieldSet, key), field => {
          let dataToVerify = _.get(data, field);
          if (path) {
            dataToVerify = _.get(data, [path, field]);
          }

          assert.ok(verifyFunction(dataToVerify), `Error in "Check.requiredFields": ${errorMessage} "${field}"`);
        });
      });
  }

  private static createErrorMessage(valueInData: any, value: any, stackPaths: string[]): string {
    const stackError = stackPaths.join('.');

    let errorMessage = `Incorrect "${stackError}".`;

    if (_.has(value, '$eMessage')) {
      errorMessage = _.isFunction(value.$eMessage) ? value.$eMessage(valueInData, value.$value) : value.$eMessage;
    }

    return errorMessage;
  }

  private static compare(operator: string, actual: any, expected: any, errorMessage: string) {
    switch (operator) {
      case '===':
        assert.ok(actual === expected, errorMessage);
        break;
      case '==':
        assert.ok(actual == expected, errorMessage);
        break;
      case '!==':
        assert.ok(actual !== expected, errorMessage);
        break;
      case '!=':
        assert.ok(actual != expected, errorMessage);
        break;
      case '>=':
        assert.ok(actual >= expected, errorMessage);
        break;
      case '<=':
        assert.ok(actual <= expected, errorMessage);
        break;
      case '<':
        assert.ok(actual < expected, errorMessage);
        break;
      case '>':
        assert.ok(actual > expected, errorMessage);
        break;
      case 'equal':
        assert.equal(actual, expected, errorMessage);
        break;
      case 'notEqual':
        assert.notEqual(actual, expected, errorMessage);
        break;
      case 'strictEqual':
        assert.strictEqual(actual, expected, errorMessage);
        break;
      case 'some':
        assert.ok(_.some(actual, expected), errorMessage);
        break;
      case 'every':
        assert.ok(_.every(actual, expected), errorMessage);
        break;
      default:
        throw new Error(`Undefined operator: "${operator}".`);
    }
  }

  private static equal<TData>(
    data: TData,
    dataToCheck: TCheckObject<TData> | Record<string, unknown>,
    stackPaths: string[] = []
  ) {
    if (_.isUndefined(data)) {
      throw new Error(`"${stackPaths.join('.')}" Not Found. See GraphQL query schema.`);
    }

    if (_.isObject(data) && !_.isObject(dataToCheck)) {
      throw new Error(`
          in "${stackPaths.join('.')}": "${_.last(stackPaths)}" is object. Cannot use default 'equal' for object.
        `);
    }

    if (
      _.isObject(data) &&
      (Object.getPrototypeOf(data) === Object.prototype || Object.getPrototypeOf(data) === null)
    ) {
      Object.keys(dataToCheck).forEach(field => {
        if (Check.keyProperties.includes(field)) {
          throw new Error(
            `in "${stackPaths.join('.')}": "${_.last(stackPaths)}" is object. You must use nesting for the object.`
          );
        }

        const valueInData = _.get(data, field);
        const value = _.get(dataToCheck, field);

        Check.equal(valueInData, value, stackPaths.concat(field));
      });
    } else {
      const stackError = stackPaths.join('.');

      if (_.isObject(dataToCheck)) {
        const $check = _.get(dataToCheck, '$check');
        if (!$check) {
          throw new Error(`in "${stackError}": "$check" required.`);
        }

        const $value = _.get(dataToCheck, '$value');
        if (_.isUndefined($value)) {
          throw new Error(`in "${stackError}": "$value" required.`);
        }

        if ($check === 'some' || $check === 'every') {
          if (!_.isArray(data)) {
            throw new Error(`in "${stackError}": ${_.last(stackPaths)} is not array.`);
          }
          if (!_.isFunction($value)) {
            throw new Error(`in "${stackError}": $value" must be a function.`);
          }

          return Check.compare($check, data, $value, Check.createErrorMessage(data, dataToCheck, stackPaths));
        }

        const $func = _.get(dataToCheck, '$func');
        if ($func) {
          if (!_.isFunction($func)) {
            throw new Error(`in "${stackError}": "$func" must be a function.`);
          }

          Check.compare($check, $func(data), $func($value), Check.createErrorMessage(data, dataToCheck, stackPaths));
        } else {
          if (_.isObject($value) || _.isObject(data)) {
            throw new Error(`in "${stackError}": "${_.last(stackPaths)}" and "$value" must be a primitive.
              "${_.last(stackPaths)}" is ${typeof data};
              "$value" is ${typeof $value};
              Possibly incorrect value in "$check".
             `);
          }

          Check.compare($check, data, $value, Check.createErrorMessage(data, dataToCheck, stackPaths));
        }
      } else {
        if (_.isUndefined(dataToCheck)) {
          throw new Error(`Your "${stackError}" is undefined.`);
        }

        Check.compare('equal', data, dataToCheck, Check.createErrorMessage(data, dataToCheck, stackPaths));
      }
    }
  }

  private static check<TData>(data: TData, dataToCheck: TCheckObject<TData>, fieldsSet?: any) {
    fieldsSet && Check.requiredFields(fieldsSet, data);

    _.forEach(dataToCheck, (value, field) => {
      const valueInData = _.get(data, field);

      if (_.isArray(valueInData)) {
        if (!_.isObject(value) || _.isArray(value)) {
          throw new Error(
            `"${field}" is array. Please use object for iteration or object to get element of array.`
          );
        }

        if (_.has(value, '$check')) {
          if (_.get(value, '$check') !== 'forEach') {
            return Check.equal(valueInData, value, [field]);
          }

          _.forEach(valueInData, data => Check.equal(data, _.omit(value, Check.keyProperties), [field]));
        } else {
          Object.keys(value).forEach(item => {
            if (!_.isNaN(Number(item))) {
              Check.equal(_.nth(valueInData, Number(item)), _.get(value, item), [field, item]);
            } else {
              throw new Error(`"${field}" is array. You must use numbers to get item in arrays.`);
            }
          });
        }
      } else {
        Check.equal(valueInData, value, [field]);
      }
    });
  }

  static data<TData>(
    data: TData | TData[],
    dataToCheck: TCheck<TData | TData[]>,
    fieldsSet?: TFieldSet<TData>
  ): void {
    if (!data) throw Error(`Not found data`);

    if (data instanceof Array) {
      if (_.isEmpty(data)) throw new Error('data is empty Array.');
      return data.forEach(data => {
        if (_.isFunction(dataToCheck)) {
          Check.check(data, dataToCheck(data), fieldsSet);
        } else {
          Check.check(data, dataToCheck, fieldsSet);
        }
      });
    }

    if (_.isFunction(dataToCheck)) {
      throw new Error(`"data" is not array. The second parameter should be an object.`);
    }

    return Check.check(data, dataToCheck, fieldsSet);
  }
}

// examples
Check.data(
  result,
  {
    members: {
      $check: 'some',
      $value: (member: Role) => member.id === homeUser.lastRoleId,
      $eMessage: 'User is not a chat member.'
    },
    contract: {
      id: _.get(contract, 'id')
    }
  }
);

Check.data(
  result,
  {
    unreadMessagesCount: {
      $check: '>=',
      $value: 0
    }
  }
);

Check.data(
  result,
  {
    contract: {
      id: _.get(contract, 'id')
    },
    members: {
      $check: 'some',
      $value: (member: Role) => member.id === homeUser.lastRoleId,
      $eMessage: 'User is not a chat member.'
    }
  }
);

Check.data(
  result,
  {
    user: {
      email: _.get(inputData, ['home', 'email']),
      'lastRole.name': _.get(inputData, ['home', 'role'])
    }
  }
);

Check.data(result, {
  'owner.id': _.get(collaboratorUser, 'lastRoleId'),
  'contract.id': _.get(contract, 'id')
});

Check.data(result, {
  text: _.get(messageInDirect, 'text'),
  tags: {
    0: tag,
    '-1': tag
  }
});

Check.data(
  result,
  {
    estimatedTime: _.get(schedule, 'estimatedTime'),
    period: {
      0: {
        $check: 'equal',
        $value: _.get(schedule, 'startDate'),
        $func: (date: Date) => moment(date).format('YYYY.MM.DD')
      },
      '-1': {
        $check: 'equal',
        $value: _.get(schedule, 'endDate'),
        $func: (date: Date) => moment(date).format('YYYY.MM.DD')
      }
    },
    task: {
      id: _.get(schedule, 'taskId'),
      assignees: {
        $check: 'every',
        $value: (member: Role) => _.get(member, 'id') !== _.get(collaboratorUser, 'roleId'),
        $eMessage: 'Collaborator should not be assignees to task after delete schedule'
      }
    },
    'creator.id': _.get(proUser, 'lastRoleId'),
    'worker.id': _.get(collaboratorUser, 'lastRoleId')
  }
);

Check.data(
  result,
  {
    ..._.pick(contract, _.without(requiredFieldSet.scalar!, 'createdAt', 'updatedAt')),
    archived: false
  }
);

Check.data(schedule, {
  ..._.omit(scheduleData, ['startDate', 'endDate'])
});

Check.data(
  result,
  {
    chargeRequestedAt: {
      $check: '===',
      $value: null
    },
    autoPayoutRequest: false
  }
);

Check.data(result, {
  'pageInfo.hasMore': false,
  messages: {
    $check: 'forEach',
    text: {
      $check: 'equal',
      $value: hashText,
      $eMessage: 'No hashtag in the message.'
    },
    chatId: {
      $check: 'equal',
      $value: _.get(groupChat, 'id'),
      $eMessage: 'Incorrect message chat.'
    },
  }
});

Check.data(result.tasks, (task: Task) => {
  const outputTask = _.find(firstPhase.tasks, { name: task.name });
  if (!outputTask) throw GraphQLError.notFound(task.name);

  return {
    id: _.get(outputTask, 'id')
  };
});

Check.data(
  result,
  (payment: any) => {
    const taskToCheck = _.find(outputData.phase!.tasks, { id: payment.task.id });
    if (!taskToCheck) throw GraphQLError.notFound('task to check');

    return {
      payoutRequestedAt: null,
      comments: {
        0: {
          subject: _.get(inputData, ['comment', 'subject']),
          text: safeHtml(_.get(inputData, ['comment', 'text'])),
          roleId: _.get(homeUser, 'lastRoleId'),
          paymentId: _.get(payment, 'id')
        }
      },
      task: {
        id: _.get(taskToCheck, ['id'])
      },
      history: {
        0: {
          action: PaymentHistoryAction.PayoutDeclined,
          type: PaymentHistoryType.User,
          createdAt: {
            $check: '===',
            $value: new Date(),
            $func: (date: Date) => moment(date).format('YYYY.MM.DD HH:M')
          },
          actionedBy: {
            id: _.get(homeUser, 'lastRoleId')
          },
          pro: {
            id: _.get(pro, 'lastRoleId')
          }
        }
      }
    };
  }
);
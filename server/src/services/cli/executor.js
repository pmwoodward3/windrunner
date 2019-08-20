'use strict';

const { exec, execFile } = require('child_process');
const execSSH = require('ssh-exec');
const EventEmitter = require('events');

const config = require('../../../config');
const winston = require('../../logger');
const { Command } = require('../../models');
const scheduler = require('../infra/schedulerService');
const { sleep } = require('../../utils');

const MAX_WORKERS = config.MAX_WORKERS;

// initialize state vars
const cmdEvents = new EventEmitter();
const cmdQ = [];
// const hooks = {};

// events
const EVENTS = {
  CMD_ADD: 'CMD_ADDED',
  CMD_DONE: 'CMD_DONE',
  WORKER_RETIRE: 'WORKER_RETIRE',
  EXECUTOR_IDLE: 'EXECUTOR_IDLE',
};

let workersActive;

function init() {
  workersActive = 0;

  // attach events
  cmdEvents.on(EVENTS.CMD_ADD, processNext);
  cmdEvents.on(EVENTS.CMD_DONE, packUp);
  cmdEvents.on(EVENTS.WORKER_RETIRE, retire);

  scheduler.addTask('check if executor is idle', watchForIdle, config.IDLE_INTERVAL);
}

// add cmd to queue and wait til it is complete
function execute(cmd, args, runRemotely) {
  // args can be null or undefined, that is OK.
  return new Promise((res, rej) => {
    //add the cmd to the queue
    let command = new Command(cmd, args, runRemotely);
    winston.debug(`pushing command into the queue with id ${command.id}`);
    cmdQ.push(command);
    cmdEvents.emit(EVENTS.CMD_ADD);

    //add new event waiter for command to finish
    cmdEvents.once(command.id, (out, err) => {
      if (err) {
        return rej(err);
      }
      else {
        return res(out);
      }
    });
  });
}

//cleanup function, should never be called ideally
function cleanup() {
  return 'NOT YET IMPLEMENTED';
}

function packUp(jobId) {
  winston.debug(`worker has completed job ${jobId}`);
  --workersActive;
  winston.debug(`${workersActive} workers active`);
  processNext();
  return;
}

function retire() {
  winston.debug('a worker is retiring');
  --workersActive;
  winston.debug(`${workersActive} workers active`);
}

async function processNext() {
  if (workersActive >= MAX_WORKERS) {
    winston.debug(`${MAX_WORKERS} workers are already active`);
    return;
  }
  else {
    ++workersActive;
    winston.debug(`worker #${workersActive} starting to work`);
  }

  if (cmdQ.length > 0) {
    //we have stuff to process
    const commandToRun = cmdQ.shift();
    let output = null;
    let error = null;

    try {
      output = await runCommand(commandToRun);
    }
    catch (err) {
      error = err;
    }

    // emit the event
    cmdEvents.emit(commandToRun.id, output, error);
    cmdEvents.emit(EVENTS.CMD_DONE, commandToRun.id);
  }
  else {
    winston.trace('no more items in command queue');
    cmdEvents.emit(EVENTS.WORKER_RETIRE);
  }
}

function runCommand(cmd) {
  if (cmd.runRemotely) {
    return runCommandRemotely(cmd);
  }
  else {
    return runCommandLocally(cmd);
  }
}

function isBusy() {
  return workersActive !== 0;
}

// mainly used to add additional hooks into the executor life cycle
function addHook(src, event, hook) {
  winston.info(`${src} is adding an executor hook on ${event}`);
  cmdEvents.on(event, hook);
}

//TODO: add remove hook

async function watchForIdle() {
  if (workersActive === 0) {
    await sleep(config.IDLE_TRIGGER_TIME);
    if (workersActive === 0) {
      cmdEvents.emit(EVENTS.EXECUTOR_IDLE);
    }
  }
}

function runCommandRemotely(cmd) {
  return new Promise((res, rej) => {
    if (config.REMOTE_HOST) {
      //if args, we have to normalize
      const commandString = cmd.toStringCmd();
      winston.info(`executing remotely using ssh-exec ${commandString}`);
      execSSH(commandString, config.REMOTE_HOST, handleExecutionResult.bind(cmd, res, rej));
    }
    else {
      winston.error('attempt to run remote command without remote host specified');
      return rej('attempt to run remote command without remote host specified');
    }
  });
}

const execOptions = { maxBuffer: Infinity };
function runCommandLocally(cmd) {
  return new Promise((res, rej) => {
    if (cmd.args === undefined) {
      winston.debug(`executing using exec ${cmd.cmd}`);
      exec(cmd.cmd, execOptions, handleExecutionResult.bind(cmd, res, rej));
    }
    else {
      winston.debug(`executing using execFile ${cmd.cmd} ${cmd.args}`);
      execFile(cmd.cmd, cmd.args, execOptions, handleExecutionResult.bind(cmd, res, rej));
    }
  });
}

function handleExecutionResult(res, rej, err, stdout, stderr) {
  // this = cmd lol
  if (err !== null) {
    winston.warn(`executor command returned an error for command ${this.toStringCmd()}`);
    winston.warn(this.toStringCmd());
    winston.warn(err);
    rej(err);
  }
  else if (stderr){
    winston.warn(`executor command returned a stderr for command ${this.toStringCmd()}`);
    winston.warn(this.toStringCmd());
    winston.warn(stderr);
    rej(stderr);
  }
  else {
    winston.verbose(`executor command finished successfully for command ${this.toStringCmd()}`);
    // if (stdout && stdout.length < 300) {
    // 	winston.verbose(`results: ${stdout}`);
    // }
    // else {
    // 	winston.silly(`results: ${stdout}`);
    // }
    res(stdout);
  }
}

module.exports = {
  run: execute,
  isBusy: isBusy,
  addHook: addHook,
  events: EVENTS,
  init: init,
  cleanup: cleanup,
};

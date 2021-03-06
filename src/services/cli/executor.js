'use strict';

const { exec, execFile } = require('child_process');
const genericPool = require('generic-pool');
const { MAX_CLI_WORKERS, HEALTH_MONITOR_INTERVAL } = require('../../../config.json');
const logger = require('../../logger');
const { Worker, Command } = require('../../models/cli');

const execOptions = { maxBuffer: Infinity };

const factory = {
  create: () => Promise.resolve(new Worker()),
  destroy: () => Promise.resolve()
};

const pool = genericPool.createPool(factory, { max: MAX_CLI_WORKERS, priorityRange: 3 });

function runImmediately(cmd, args, opts) {
  return run(cmd, args, opts, 0);
}

async function run(cmd, args, opts, priority) {
  // args can be null or undefined, thaut is OK.
  if (priority === undefined) {
    priority = 2;
  }

  const command = new Command(cmd, args, opts);
  logger.debug(`pushing command into the queue with id ${command.id}`);
  let worker;

  try  {
    worker = await pool.acquire(priority);
    const output = await runCommand(command);
    pool.release(worker);
    return output;
  }
  catch (err) {
    logger.error(err);
    pool.release(worker);
  }
}

function runCommand(cmd) {
  return new Promise((res, rej) => {
    if (cmd.args === undefined) {
      logger.debug(`executing using exec ${cmd.cmd}`);
      exec(cmd.cmd, execOptions, handleExecutionResult.bind(cmd, res, rej));
    }
    else {
      logger.debug(`executing using execFile ${cmd.cmd} ${cmd.args}`);
      execFile(cmd.cmd, cmd.args, { ...execOptions, ...cmd.opts }, handleExecutionResult.bind(cmd, res, rej));
    }
  });
}

function handleExecutionResult(res, rej, err, stdout, stderr) {
  // this = cmd lol
  if (err !== null) {
    logger.warn(`executor command returned an error for command ${this.toStringCmd()}`);
    logger.warn(this.toStringCmd());
    logger.warn(err);
    rej(err);
  }
  else if (stderr){
    logger.warn(`executor command returned a stderr for command ${this.toStringCmd()}`);
    logger.warn(this.toStringCmd());
    logger.warn(stderr);
    rej(stderr);
  }
  else {
    logger.verbose(`executor command finished successfully for command ${this.toStringCmd()}`);
    // if (stdout && stdout.length < 300) {
    // 	logger.verbose(`results: ${stdout}`);
    // }
    // else {
    // 	logger.silly(`results: ${stdout}`);
    // }
    res(stdout);
  }
}

async function shutdown() {
  await pool.drain();
  pool.clear();
}

function health() {
  return {
    max: pool.max,
    size: pool.size,
    available: pool.available,
    waiting: pool.pending
  };
}

function startHealthMonitor() {
  if (HEALTH_MONITOR_INTERVAL > 0) {
    setInterval(() => {
      logger.verbose(health());
    }, HEALTH_MONITOR_INTERVAL)
  }
}

module.exports = {
  runImmediately,
  run,
  shutdown,
  health
};

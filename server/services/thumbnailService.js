'use strict';

const fs = require('fs').promises;
const path = require('path');

const config = require('../config');
const winston = require('../winston');
const executor = require('../utils/executor');
const videoMetaDataService = require('./videoMetadataService');
const thumbnailDb = require('./levelDbService').instanceFor('thumbnails');
const utility = require('../utils/utility');
const bgWorker = require('./backgroundWorkerService');

async function makeThumbnails(filePath) {
  let thumbs = await thumbnailsExist(filePath)
  if (thumbs === false) {
    // check if we have the thumbnails and whether they have been generated already
    winston.debug(`generating thumbnails for ${filePath}`);

    const fileName = path.basename(filePath);
    const imgFolder = path.join(config.THUMBNAIL_DIR, fileName);
    let vidLen = await videoMetaDataService.duration(filePath);
    if (vidLen === -1) {
      vidLen = 1200;
    }
    const thumbnailTimeUnit = Math.floor(vidLen / (config.MAX_THUMBNAILS + 1));
    const thumbnailPromises = [];
    const outputFiles = [];

    //ensure output dir exists
    try {
      await fs.mkdir(imgFolder, {recursive: true});

      for (let i = 0; i < config.MAX_THUMBNAILS; ++i) {
        //calculate time splits
        const frameRipTime = secondsToHms(thumbnailTimeUnit * (i+1));
        const outputPath =  path.join(imgFolder, frameRipTime.replace(/:/g, '_') + '.jpg');

        thumbnailPromises.push(
          executor.run('ffmpeg', 
          ['-ss', frameRipTime, // set the time we want
          '-t', '1', '-i', filePath, '-s', '320x180', '-f', 'mjpeg', outputPath, 
          '-y', // say yes to overwrite
          '-loglevel', 'error' // hide all output except true errors since ffmpeg pipes stdout to stderr instead
        ]));
        outputFiles.push(outputPath);
      }

      await Promise.all(thumbnailPromises);
      await thumbnailDb.put(filePath, outputFiles);
    }
    catch (e) {
      winston.error(`there was an error when generating thumbnails for ${filePath}`);
      console.log(e);
    }
  }
  else {
    console.log(`thumbnails already exist for ${filePath}`);
    winston.silly(`thumbnails already exist for ${filePath}`);
  }
}

async function thumbnailsExist(filePath) {
  const thumbList = await getThumbnails(filePath);
  return (thumbList.length === config.MAX_THUMBNAILS);
}

async function getThumbnails(filePath) {
  const thumbList = await thumbnailDb.get(filePath);
  return (thumbList === undefined) ? [] : thumbList;
}

function secondsToHms(d) {
    d = Number(d);

    const h = zeroPad(Math.floor(d / 3600));
    const m = zeroPad(Math.floor(d % 3600 / 60));
    const s = zeroPad(Math.floor(d % 3600 % 60));

    return `${h}:${m}:${s}`;
}

function zeroPad(n) {
  return ('0' + n).slice(-2);
}

async function quietlyGenerateThumbnails() {
//  const cmd = `find ${config.SHARE_PATH} -not -path '*/\.*' -type f`;
  try {
    const allFiles = await executor.run('find',
      [config.SHARE_PATH, '-not', '-path', '*/\.*', '-type', 'f']);

      allFiles.split('\n')
        .filter(filename => (filename.length > 0)) 
        .filter(filename => (utility.isVideo(filename)))
        .forEach((fileName) => {
          bgWorker.addBackgroundTask(makeThumbnails.bind(null, fileName));
        });
  }
  catch(e) {
    console.log(e);
  }
}

// fix this
quietlyGenerateThumbnails();

module.exports = {
  makeThumbnails: makeThumbnails,
  getThumbnails: getThumbnails,
};

async function main() {
  await makeThumbnails('/mnt/c/Users/Neilson/Torrents/[Nep_Blanc] Trinity Seven OVA .mkv');
}
'use strict';

const path = require('path');
const fs = require('fs').promises;
const imagemin = require('imagemin');
const imageminJpegtran = require('imagemin-jpegtran');

const config = require('../../../config');
const winston = require('../../logger');
const { fileList, thumbnailer, videoMetadata } = require('../cli');
const { thumbnails } = require('../data');
const { isVideo } = require('../../utils');

const { backgroundWorker, scheduler } = require('../infra');

async function makeThumbnails(filePath) {
  const fileName = path.basename(filePath);
  const thumbs = await thumbnailsExist(fileName);
  if (thumbs === false) {
    // check if we have the thumbnails and whether they have been generated already
    winston.verbose(`generating thumbnails for ${filePath}`);

    const imgFolder = path.join(config.THUMBNAIL_DIR, fileName);
    let vidLen = await videoMetadata.duration(filePath);
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
        const outFileName = frameRipTime.replace(/:/g, '_') + '.jpg';
        const outputPath =  path.join(imgFolder, outFileName);

        thumbnailPromises.push(thumbnailer.generateThumbnail(filePath, outputPath, frameRipTime));
        outputFiles.push(outFileName);
      }

      await Promise.all(thumbnailPromises);
      await thumbnails.setThumbnailList(fileName, outputFiles);
      await minifyFolder(imgFolder);
      winston.verbose(`successfully generated thumbnails for ${filePath}`);
    }
    catch (e) {
      winston.error(`there was an error when generating thumbnails for ${filePath}`);
      winston.error(e);
      console.log(e);
    }
  }
  else {
    winston.debug(`thumbnails already exist for ${filePath}`);
  }
}

async function thumbnailsExist(fileName) {
  const thumbList = await getThumbnailList(fileName);
  return (thumbList.length === config.MAX_THUMBNAILS);
}

async function getThumbnailList(fileName) {
  return await thumbnails.getThumbnailList(fileName);
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

async function getThumbnailPath(fileName, imgFile) {
  const thumbList = await getThumbnailList(fileName);
  if (thumbList.includes(imgFile)) {
    return path.join(config.THUMBNAIL_DIR, fileName, imgFile);
  }
  return null;
}

//perhaps move this into an init and use the scheduler or something
async function quietlyGenerateThumbnails() {
  try {
    const allFiles = await fileList.listAll(config.SHARE_PATH);
    allFiles.split('\n')
      .filter(fileName => (fileName.length > 0)) 
      .filter(fileName => (isVideo(fileName)))
      .filter(async (fileName) => {
        const exists = await thumbnailsExist(fileName);
        return !exists;
      })
      .forEach((fileName) => {
        backgroundWorker.addBackgroundTask(makeThumbnails.bind(null, fileName));
      });
  }
  catch(e) {
    winston.error('there was an issue quietly generating thumbnails in the background');
    winston.error(e);
  }
}

async function minifyFolder(folder) {
  const jpgWildCard = path.join(folder, '*.jpg');
  try {
    await imagemin([jpgWildCard], {
      destination: folder,
      plugins: [ imageminJpegtran() ]
    });
    winston.verbose(`image compression complete for ${folder}`);
  }
  catch (e) {
    winston.warn('an error occurred when minifying the images');
    winston.warn(e);
  }
}

const ONE_DAY = 60 * 60 * 24 * 1000;
function startBackgroundTask() {
  scheduler.addTask('thumbnail bg worker', quietlyGenerateThumbnails, ONE_DAY);
}

module.exports = {
  makeThumbnails: makeThumbnails,
  getThumbnailList: getThumbnailList,
  getThumbnailPath: getThumbnailPath,
  startBackgroundTask: startBackgroundTask,
};

// async function main() {
//   await makeThumbnails('/mnt/c/Users/Neilson/Torrents/[Nep_Blanc] Trinity Seven OVA .mkv');
// }

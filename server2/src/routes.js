'use strict';

const Router = require('koa-router');

const { API_VERSION } = require('../config.json');
const listingController = require('./controllers/listingController');
const favouritesController = require('./controllers/favouritesController');
const imagesController = require('./controllers/imagesController');
const metaController = require('./controllers/metaController');
const waitingController = require('./controllers/waitingController');
const seriesDataController = require('./controllers/seriesDataController');

const API_PREFIX = `/api/v${API_VERSION}/`;

const router = new Router();
router.prefix(API_PREFIX);

router.get('/hello', metaController.hello);
router.get('/info', metaController.getServerInfo);
router.get('/load', metaController.getExecLoad);

router.get('/browse', listingController.browse);
router.get('/browse/:path', listingController.browse);
router.get('/details/:filePath', listingController.details);
router.get('/recent', listingController.recent);
router.get('/recent2', listingController.recent2);

router.get('/favs', favouritesController.favourites);
router.post('/fav', favouritesController.addFavourite);
router.del('/fav/:folderPath', favouritesController.removeFavourite);
router.get('/fav/:folderPath', favouritesController.isFavourite);

router.get('/img/thumbs/:imageId', imagesController.getThumbnail);
router.get('/img/series/:imageId', imagesController.getSeriesImage);

router.get('/resource/:id', waitingController.getStatus);

router.get('/series/options/:folderPath', seriesDataController.listSeriesOptions);
router.put('/series', seriesDataController.updateSeriesOption);

module.exports = router;

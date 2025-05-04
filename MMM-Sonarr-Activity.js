/* global Log, Module, moment, config */
/* Magic Mirror
 * Module: MMM-Sonarr-Activity
 *
 * By Stephen Cotton
 * MIT Licensed.
 */

//var Module, Log, moment, config, Log, moment, document;

Module.register("MMM-Sonarr-Activity", {

     // Default module config.
    defaults: {
        sonarrProtocol: "http",
        sonarrHost: "localhost",
        sonarrPort: "8989",
        sonarrAPIKey: "",

        displayType: "list",
        perPage: 15,
        scrollTimeout: 10000,
        scrollEffect: 'scrollHorz',

        updateInterval: 5 * 60 * 1000,

        debug: false,
    },

    data: {
        header: 'Recent Sonarr Activity'
    },

    components: {
        models: {},
        views: {},    
        collections: {},
    },

    models: [],
    updateViews: [],
    updatesCollection: null,
    mainView: null,

    updater: null,
    lastUpdate: 0,

    suspend: function(){
        this.stopUpdateTimer();
        if( this.mainView !== null ){
            this.mainView.trigger("stopSlider");
        }
    },
    resume: function(){
        this.startUpdateTimer();
        if( this.mainView !== null ){
            this.mainView.trigger("startSlider");
        }
    },

    // Subclass start method.
    start: function () {
        Log.info("Starting module: " + this.name);
        if (this.config.debug) Log.info(this.name + " config: ", this.config);

        var self = this;
        
        this.setupModels();
        this.setupViews();

        self.getLatestActivity();

        this.startUpdateTimer();

    },

    startUpdateTimer: function(){
        var self = this;
        if( moment().valueOf() - this.lastUpdate > this.config.updateInterval ){
            this.getLatestActivity();
        }
        this.updater = setInterval(function(){
            self.getLatestActivity();
        }, this.config.updateInterval );
    },

    stopUpdateTimer: function(){
        clearInterval(this.updater);
    },

    setupModels: function(){
        this.components.models.update = Backbone.Model.extend({
            defaults: {
                seriesName        : "",
                seString          : "",
                episodeName       : "",
                episodeDescription: "",
                seriesPoster      : "",
                episodeDate       : "",
                id                : 0,
                type              : "snatched"
            },
            initialize: function(){

            }
        });
    },

    setupViews: function(){
        var self = this;
        this.components.views.singleUpdate = Backbone.View.extend({
            tagName: "div",
            className: "single-activity",
            template: MMMSonarrActivity.Templates.slide,
            initialize: function(){},
            render: function(){
                return this.template( this.model.toJSON() );
            }
        });
        this.components.collections.updates = Backbone.Collection.extend({
            model: self.components.models.update
        })
        this.components.views.updateSlider = Backbone.View.extend({
            tagName: "div",
            className: 'cycle-slideshow episode-slideshow',
            template: MMMSonarrActivity.Templates.main,
            attributes: function(){
                return {
                    'data-cycle-fx' : self.config.scrollEffect,
                    'data-cycle-timeout': self.config.scrollTimeout,
                    'data-cycle-slides': "> div",
                    //'data-cycle-paused': "true",
                }
            },
            initialize: function(){
                var that = this;
                this.updateViews = [];

                this.collection.each(function(update){
                    that.updateViews.push( new self.components.views.singleUpdate({
                        model: update
                    }));
                });
                this.on("startSlider", this.startSlider, this);
                this.on("stopSlider", this.stopSlider, this);
            },
            render: function(){
                this.$el.on('error','img',function(e){
                    console.error(e);
                    $(e.target).attr('src', self.file("images/no-image.png"));
                });
                var that = this;
                this.$el.empty()
                _(this.updateViews).each(function(updateView){
                    that.$el.append( updateView.render() );
                });

                this.$el.cycle({
                    fx: self.config.scrollEffect,
                    timeout: self.config.scrollTimeout,
                    slides: "> div"
                });
                return this;
            },
            startSlider: function(){
                this.$el.cycle('resume');
            },
            stopSlider: function(){
                this.$el.cycle('pause');
            }
        });
    },

    getScripts: function() {
        return [
            'moment.js',
            'https://code.jquery.com/jquery-2.2.3.min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/underscore.js/1.8.3/underscore-min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/backbone.js/1.3.3/backbone-min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/handlebars.js/4.0.6/handlebars.runtime.min.js',
            'https://cdnjs.cloudflare.com/ajax/libs/jquery.cycle2/2.1.6/jquery.cycle2.min.js',
            this.file('templates.js')
        ];
    },

    getStyles: function() {
        return [
            this.file('css/main.css')
        ];
    },

    // Subclass socketNotificationReceived method.
    socketNotificationReceived: function (notification, payload) {
        if (this.config.debug) Log.info(this.name + " received a notification: " + notification, payload);
        var self = this;
    },

    buildApiUrl: function(){
        return this.config.sonarrProtocol + "://" + this.config.sonarrHost + ':' + this.config.sonarrPort 
        + '/api/v3/history?apikey=' + this.config.sonarrAPIKey + '&pageSize=' + this.config.perPage;
    },


    getLatestActivity: function(){
        if (this.config.debug) Log.info('Sonarr asking for refresh of activity');
        this.refreshActivity();
    },

    refreshActivity: function(){
        var latestActivity;
        latestActivity = [];
        var self = this;

        var activityRequest = new XMLHttpRequest();
        activityRequest.open("GET", this.buildApiUrl(), true);
        activityRequest.onreadystatechange = function() {
            if (this.readyState === 4) {
                if (this.status === 200) {
                    self.lastUpdate = moment().valueOf();
                    self.processActivity(JSON.parse(this.response));
                } 
            }
        };
        activityRequest.send();
    },

    processActivity: function(data){
	console.log("Sonarr activity data:", data);
        if( this.config.debug) Log.info( data );
        this.activity = data.records;

        this.models = [];

        for( var record_i in data.records ){
            var thisDataRecord = data.records[ record_i ];
            if( thisDataRecord.eventType != "downloadFolderImported" ) continue;
            if( this.config.debug) Log.info(thisDataRecord);
            var newUpdateRecord = new this.components.models.update( this.processActivityRecord( thisDataRecord ) );
            this.models.push( newUpdateRecord );
        }
        this.updateDom();
        //this.sendSocketNotification("ACTIVITY_LOADED", data);
    },

    processActivityRecord: function(record){
        return {
            seriesName        : record.series.title,
            seString          : "S" + this.formatSENumber( record.episode.seasonNumber ) + 'E' + this.formatSENumber( record.episode.episodeNumber ),
            episodeName       : record.episode.title,
            episodeDescription: record.episode.overview,
            seriesPoster      : this.getSeriesPoster( record.series.id ),
            episodeDate       : record.episode.airDate,
            id                : record.id,
            type              : record.eventType
        };
    },

    formatSENumber: function(number){
        return number < 10 ? '0' + number : number;
    },

    getSeriesPoster: function(seriesId){
        return this.config.sonarrProtocol + "://" + this.config.sonarrHost + ':' + this.config.sonarrPort 
            + '/api/MediaCover/' + seriesId + '/poster-250.jpg?apikey=' + this.config.sonarrAPIKey;
    },

    // Override dom generator.
    getDom: function () {
        var wrapper, self;

        var updatesCollection = new this.components.collections.updates( this.models );
        var updatesView = new this.components.views.updateSlider({
            collection: updatesCollection
        });

        return updatesView.render().el;

    },
});

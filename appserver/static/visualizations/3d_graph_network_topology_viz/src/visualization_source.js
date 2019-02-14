/*
 * Visualization source
 */
define([
            'jquery',
            'underscore',
            'vizapi/SplunkVisualizationBase',
            'vizapi/SplunkVisualizationUtils',
            'd3',
            '3d-force-graph',
            'force-graph'
            // Add required assets to this list
        ],
        function(
            $,
            _,
            SplunkVisualizationBase,
            SplunkVisualizationUtils,
            d3,
            ForceGraph3D,
            ForceGraph
        ) {

    // Extend from SplunkVisualizationBase
    return SplunkVisualizationBase.extend({

        initialize: function() {
            this.logging = true;
            if(this.logging) console.log('initialize() - Entered');

            SplunkVisualizationBase.prototype.initialize.apply(this, arguments);
            this.graph3d = null;
            this.graph = null;

            this.$el = $(this.el);
            this.uuid = this._get_uuid();
            // this.$el.css('id','viz_base')
            this.$el.append('<div class="graphviz-container" name="' + this.uuid + '"></div>');
            var controllerbar = '<div class="graphviz-controllers" name="cntl' + this.uuid + '">' +
                                    '<a id="btnPlayAnimation" style="margin: 8px;" href="#" class="btn btn-primary">' +
                                        '<i class="icon-play"></i></a>' +
                                    '<a id="btnPauseAnimation" style="margin: 8px;" href="#" class="btn btn-primary">' +
                                        '<i class="icon-pause"></i></a>' +
                                '</div>';
            this.$el.append(controllerbar);

            var that = this;

            setTimeout(() => {
              $('div[name=cntl'+that.uuid+'] > a#btnPlayAnimation').on('click', event => {
                event.preventDefault(); // to avoid re-direction
                that._toggleAnimation(1);
              });

              $('div[name=cntl'+that.uuid+'] > a#btnPauseAnimation').on('click', event => {
                event.preventDefault(); // to avoid re-direction
                that._toggleAnimation(0);
              });
            }, 100);
        },

        onConfigChange: function(config) {
            if(this.logging) console.log('onConfigChange() - Entered');

            var elem = $('div[name=cntl'+this.uuid+']');
            var showAnimationBar = SplunkVisualizationUtils.normalizeBoolean(this._getEscapedProperty('showAnimationBar', config));

            if (showAnimationBar && !elem.hasClass("show")) {
                elem.toggleClass("show");
            } else if (!showAnimationBar && elem.hasClass("show")) {
                elem.toggleClass("show");
            } else {
              // Re-rendering the viz to apply config changes
              this.invalidateReflow();
            }
        },

        // Optionally implement to format data returned from search.
        // The returned object will be passed to updateView as 'data'
        formatData: function(data) {
            if(this.logging) console.log('formatData() - Entered');
            // Expects:
            // <search> | stats count by src dst

            var fields = data.fields;
            var rows = data.rows;
            var nodes = [],
                links = [];

            if (rows.length < 1 && fields.length < 1) {
                return false;
            }

            // console.log(rows);
            // console.log(fields);

            // Avoid duplicates!
            let node_ids = new Set();

            _.each(rows, function(row) {
                // Iterating over 0-1 to get row columns
                _.each([...Array(2).keys()], function(ix) {
                  var id = row[ix],
                      name = id;
                      // TODO which name??
                      // name = fields[ix].name + ": " + id;

                  if (!node_ids.has(id)){
                    var new_node = {
                      "id": id,
                      "name": name,
                      "val": 1,
                    };
                    nodes.push(new_node);
                    node_ids.add(id);
                  }
                });

                var new_link = {
                  "source": row[0],
                  "target": row[1]
                };
                links.push(new_link);
            });

            return {
              "fields": fields,
              "content": {
                "nodes": nodes,
                "links": links
              }
            };
        },

        // Implement updateView to render a visualization.
        //  'data' will be the data object returned from formatData or from the search
        //  'config' will be the configuration property object
        updateView: function(data, config) {
            if (this.logging) console.log("updateView() - Entering");

            // check for data
            if (!data || data.content.nodes.length < 1) {
                if(this.logging) console.log('updateView() - Error: no data');
                return;
            }

            var that = this;
            var elem = $('div[name=' + this.uuid + ']').get(0);

            this.enable3D = SplunkVisualizationUtils.normalizeBoolean(this._getEscapedProperty('enable3D', config));
            this.bgColor = this._getEscapedProperty('bgColor', config) || '#000011';
            this.cameraController = this._getEscapedProperty('cameraController', config) || 'trackball';
            this.useDrilldown = this._isEnabledDrilldown(config);

            // Rendering graphs
            if (this.enable3D) {
                this._load_3d_graph(elem, data.content);
                this.graph = ForceGraph();

            } else {
                this.graph = ForceGraph()(elem)
                    .onNodeHover(node => {
                      // Change cursor when hovering on nodes (if drilldown enabled)
                      elem.style.cursor = node && that.useDrilldown ? 'pointer' : null;
                    })
                    .onNodeClick(that._drilldown.bind(that))
                    .backgroundColor(this.bgColor)
                    .graphData(data.content);

                this.graph3d = ForceGraph3D({ controlType: this.cameraController });
            }
        },

        // Search data params
        getInitialDataParams: function() {
            return ({
                outputMode: SplunkVisualizationBase.ROW_MAJOR_OUTPUT_MODE,
                count: 0
            });
        },

        _load_3d_graph: function(elem, data){
            const distance = 1000;
            var that = this;

            this.graph3d = ForceGraph3D({ controlType: this.cameraController })(elem)
              .cameraPosition({ z: distance })
              .onNodeHover(node => {
                // Change cursor when hovering on nodes (if drilldown enabled)
                elem.style.cursor = node && that.useDrilldown ? 'pointer' : null;
              })
              .onNodeClick(that._drilldown.bind(that))
              .backgroundColor(this.bgColor)
              .graphData(data);
        },

        _getConfig: function() {
            return this._config;
        },

        _get_uuid: function () {
          // Math.random should be unique because of its seeding algorithm.
          // Convert it to base 36 (numbers + letters), and grab the first 9 characters
          // after the decimal.
          return '_' + Math.random().toString(36).substr(2, 9);
        },

        _isEnabledDrilldown: function(config) {
          return (config['display.visualizations.custom.drilldown']
                  && config['display.visualizations.custom.drilldown'] === 'all');
        },

        _drilldown: function(d, i) {
            if(this.logging) console.log("drilldown() - Entered");

            var fields = this.getCurrentData().fields;
            var drilldownDescription = {
                action: SplunkVisualizationBase.FIELD_VALUE_DRILLDOWN,
                data: {}
            };

            drilldownDescription.data[fields[0].name] = d.id;

            this.drilldown(drilldownDescription, d3.event);
        },

        _getEscapedProperty: function(name, config) {
            var propertyValue = config[this.getPropertyNamespaceInfo().propertyNamespace + name];
            return SplunkVisualizationUtils.escapeHtml(propertyValue);
        },

        _toggleAnimation: function(value) {
            if(this.logging) console.log('_toggleAnimation() - Resuming Animation ? ' + value);

            var elem = $('div[name=' + this.uuid + ']').get(0);
            var config = this._getConfig();
            var enable3D = SplunkVisualizationUtils.normalizeBoolean(this._getEscapedProperty('enable3D', config));
            var resumeAnimation = SplunkVisualizationUtils.normalizeBoolean(value);
            var graph = enable3D ? this.graph3d(elem) : this.graph(elem);

            resumeAnimation ? graph.resumeAnimation() : graph.pauseAnimation();
        },

        // Override to respond to re-sizing events
        reflow: function() {
            if(this.logging) console.log('reflow() - size this.el ('+this.$el.width()+','+this.$el.height()+')');

            var config = this._getConfig();
            var elem = $('div[name=' + this.uuid + ']').get(0);
            var cameraController = this._getEscapedProperty('cameraController', config);
            var enable3D = SplunkVisualizationUtils.normalizeBoolean(this._getEscapedProperty('enable3D', config));
            var bgColor = this._getEscapedProperty('bgColor', config) || '#000011';

            // Re-render canvas opportunely
            if (this.graph3d || this.graph){
              var hasCanvasChanged = this.enable3D != enable3D;
              this.enable3D = enable3D;

              // Get data stored in graph
              let { nodes, links } = hasCanvasChanged ?
                    (enable3D ? this.graph.graphData() : this.graph3d.graphData()) : 
                        (enable3D ? this.graph3d.graphData() : this.graph.graphData());

              if (enable3D && this.cameraController != cameraController) {
                  // Rebuild graph w/ different camera type
                  this.cameraController = cameraController;
                  this._load_3d_graph(elem, {nodes, links});
              }

              // Reload in resized canvas
              var graph = enable3D ? this.graph3d(elem) : this.graph(elem);
              graph.width(this.$el.width())
                    .height(this.$el.height())
                    .backgroundColor(bgColor)
                    .graphData({ nodes, links });
            }
        }
    });
});

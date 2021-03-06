var MiddlewareStack = Iron.MiddlewareStack;
var Url = Iron.Url;
var Layout = Iron.Layout;
var assert = Iron.utils.assert;
var DEFAULT_NOT_FOUND_TEMPLATE = '__IronRouterNotFound__';

/**
 * Client specific initialization.
 */
Router.prototype.init = function (options) {
  var self = this;

  // the current RouteController from a dispatch
  self._currentController = null;

  // the current route
  self._currentRoute = null;

  // the current() dep
  self._currentDep = new Deps.Dependency;

  // the location computation
  self._locationComputation = null;

  // the ui layout for the router
  self._layout = new Layout({template: self.options.layoutTemplate});

  Meteor.startup(function () {
    setTimeout(function maybeAutoInsertRouter () {
      if (self.options.autoRender !== false)
        self.insert({el: document.body});
    });
  });
};

/**
 * Programmatically insert the router into document.body or a particular
 * element with {el: 'selector'}
 */
Router.prototype.insert = function (options) {
  this._layout.insert(options);
  return this;
};

/**
 * Returns a layout view that can be used in a UI helper to render the router
 * to a particular place.
 */
Router.prototype.createView = function () {
  return this._layout.create();
};

Router.prototype.lookupNotFoundTemplate = function () {
  return this.options.notFoundTemplate || DEFAULT_NOT_FOUND_TEMPLATE;
};

Router.prototype.dispatch = function (url, context, done) {
  var self = this;

  assert(typeof url === 'string', "expected url string in router dispatch");

  var controller = this._currentController;
  var route = this.findFirstRoute(url);
  var prevRoute = this._currentRoute;

  this._currentRoute = route;

  if (controller && route && prevRoute === route) {
    // this will change the parameters dep so anywhere you call
    // this.getParams will rerun if the parameters have changed
    controller.configureFromUrl(url, context);
  } else {
    // Looks like we're on a new route so we'll create a new
    // controller from scratch.
    controller = this.createController(url, context);
  }

  // even if we already have an existing controller we'll stop it
  // and start it again. But since the actual controller instance
  // hasn't changed, the helpers won't need to rerun.
  if (this._currentController)
    this._currentController.stop();

  this._currentController = controller;

  controller.dispatch(self._stack, url, function (err) {
    if (err)
      throw err;
    else {
      if (!controller.isHandled() && controller.willBeHandledOnServer()) {
        window.location = controller.url;
        return;
      } else if (!controller.isHandled() && !controller.willBeHandledOnServer()) {
        // looks like there's no handlers so let's give a default
        // not found message!
        this.render(self.lookupNotFoundTemplate(), {data: {url: this.url}});
        return;
      } else {
        return done && done(err);
      }
    }
  });

  // Note: even if the controller didn't actually change I change the
  // currentDep since if we did a dispatch, the url changed and that
  // means either we have a new controller OR the parameters for an
  // existing controller have changed.
  if (this._currentController == controller)
    this._currentDep.changed();

  return controller;
};

/**
 * The current controller object.
 */
Router.prototype.current = function () {
  this._currentDep.depend();
  return this._currentController;
};

/*
 * Scroll to a specific location on the page.
 * Overridable by applications that want to customize this behavior.
 */
Router.prototype._scrollToHash = function (hashValue) {
  try {
    var $target = $(hashValue);
    $('html, body').scrollTop($target.offset().top);
  } catch (e) {
    // in case the hashValue is bogus just bail out
  }
};

/**
 * Start reacting to location changes.
 */
Router.prototype.start = function () {
  var self = this;
  var prevLocation;

  self._locationComputation = Deps.autorun(function locationComputation (c) {
    var controller;
    var loc = Iron.Location.get();
    var hash, pathname, search;
    var current = self._currentController;

    // see if only the hash part has changed
    if (prevLocation && prevLocation.path == loc.path && prevLocation.hash !== loc.hash) {
      // shouldn't we invalidate the controller's params?
      self._scrollToHash(loc.hash);
      // since the hash has changed we can invalidate any getParams
      // computations
      current.configureFromUrl(loc.href);
    } else {
      controller = self.dispatch(loc.href);

      // if we're going to the server cancel the url change
      if (controller.willBeHandledOnServer())
        loc.cancelUrlChange();
    }

    prevLocation = loc;
  });
};

/**
 * Stop all computations and put us in a not started state.
 */
Router.prototype.stop = function () {
  if (!this._isStarted)
    return;

  if (this._locationComputation)
    this._locationComputation.stop();

  if (this._currentController)
    this._currentController.stop();

  this._isStarted = false;
};

/**
 * Go to a given path or route name, optinally pass parameters and options.
 *
 * Example:
 * router.go('itemsShowRoute', {_id: 5}, {hash: 'frag', query: 'string});
 */
Router.prototype.go = function (routeNameOrPath, params, options) {
  var self = this;
  var isPath = /^\/|http/;
  var path;

  options = options || {};

  if (isPath.test(routeNameOrPath)) {
    // it's a path!
    path = routeNameOrPath;
  } else {
    // it's a route name!
    var route = self.routes[routeNameOrPath];
    assert(route, "No route found named " + JSON.stringify(routeNameOrPath));
    path = route.path(params, _.extend(options, {throwOnMissingParams: true}));
  }

  // let Iron Location handle it and we'll pick up the change in
  // Iron.Location.get() computation.
  Iron.Location.go(path, options);
};

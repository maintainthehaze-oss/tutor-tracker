'use strict';
// The root entry never loads the retired application's record writers.
location.replace(new URL('protected/' + location.hash, location.href).href);

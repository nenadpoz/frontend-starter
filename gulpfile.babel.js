import gulp from "gulp";
import fs from "fs-extra";
import gulpif from "gulp-if";
import yargs from "yargs";
import browserSync from "browser-sync";
import sourcemaps from "gulp-sourcemaps";
import imagemin from "gulp-imagemin";
import imageminGifsicle from "imagemin-gifsicle";
import imageminMozjpeg from "imagemin-mozjpeg";
import imageminPngquant from "imagemin-pngquant";
import nunjucksRender from "gulp-nunjucks-render";
import data from "gulp-data";
import beautify from "gulp-jsbeautifier";
import yaml from "js-yaml";
import sass from "gulp-sass";
import postcss from "gulp-postcss";
import cssnano from "cssnano";
import autoprefixer from "autoprefixer";
import babel from "babelify";
import browserify from "browserify";
import source from "vinyl-source-stream";
import buffer from "vinyl-buffer";
import uglify from "gulp-uglify";
import gulpStylelint from "gulp-stylelint";
import gulpEslint from "gulp-eslint";
import purgecss from "gulp-purgecss";
import gzip from "gulp-gzip";
import RevAll from "gulp-rev-all";
import RevDelete from "gulp-rev-delete-original";
const critical = require("critical").stream;

// Check for "--production" flag
const PRODUCTION = !!yargs.argv.production;

// Load settings from config.yml file
function loadConfig() {
  const configFile = fs.readFileSync("config.yml");
  return yaml.load(configFile);
}
const { PATHS, PORT } = loadConfig();

// Remove the "docs" folder
function cleanUp(done) {
  fs.removeSync(PATHS.docs);
  done();
}

// Compile SCSS into CSS
// In production CSS is prefixed and compressed
function css() {
  return gulp
    .src("src/assets/scss/app.scss")
    .pipe(sourcemaps.init())
    .pipe(sass({ includePaths: PATHS.sassLibs }).on("error", sass.logError))
    .pipe(gulpif(PRODUCTION, postcss([autoprefixer(), cssnano()])))
    .pipe(gulpif(!PRODUCTION, sourcemaps.write(".")))
    .pipe(gulp.dest(`${PATHS.docs}/assets/css`));
}

// Stylelint for CSS & SCSS
function stylelint(done) {
  return gulp
    .src("src/**/*.{css,scss}")
    .pipe(
      gulpStylelint({ reporters: [{ formatter: "string", console: true }] }).on(
        "error",
        done
      )
    );
}

// Create critical CSS
function criticalCSS() {
  return gulp
    .src(`${PATHS.docs}/**/*.html`)
    .pipe(
      critical({
        base: PATHS.docs,
        inline: true,
        css: [`${PATHS.docs}/assets/css/app.css`]
      }).on("error", function(err) {
        console.error(err.message);
      })
    )
    .pipe(gulp.dest(PATHS.docs));
}

// Remove unused CSS
function cleanUnusedCSS() {
  return gulp
    .src(`${PATHS.docs}/**/*.css`)
    .pipe(
      purgecss({
        content: [`${PATHS.docs}/**/*.{html,js}`]
      })
    )
    .pipe(gulp.dest(PATHS.docs));
}

// Compress assets
function compressAssets() {
  return gulp
    .src(`${PATHS.docs}/**/*.{css,js,html}`)
    .pipe(gzip({ extension: "gzip" }))
    .pipe(gulp.dest(PATHS.docs));
}

// Revisioning files
function revFiles() {
  return gulp
    .src(`${PATHS.docs}/**/*.{css,html,js}`)
    .pipe(
      RevAll.revision({
        dontRenameFile: [/.html/g],
        dontUpdateReference: [".html"]
      })
    )
    .pipe(RevDelete())
    .pipe(gulp.dest(PATHS.docs));
}

// Eslint for JS
function eslint(done) {
  return gulp
    .src("src/**/*.js")
    .pipe(gulpEslint())
    .pipe(gulpEslint.format("stylish"))
    .pipe(gulpEslint.failAfterError())
    .on("error", done);
}

// Compile JS and transform with Babel
// In production JS is compressed
function js() {
  const bundler = browserify("src/assets/js/app.js", { debug: true }).transform(
    babel
  );
  return bundler
    .bundle()
    .on("error", function(err) {
      console.error(err.message);
      this.emit("end");
    })
    .pipe(source("app.js"))
    .pipe(buffer())
    .pipe(sourcemaps.init({ loadMaps: true }))
    .pipe(gulpif(!PRODUCTION, sourcemaps.write(".")))
    .pipe(gulpif(PRODUCTION, uglify()))
    .pipe(gulp.dest(`${PATHS.docs}/assets/js`));
}

// Compile Nunjucks into HTML
// but skips the "layouts", "partials" & "macros" folder
function html() {
  return gulp
    .src([
      "src/pages/**/*.html",
      "!src/pages/components/**",
      "!src/pages/includes/**",
      "!src/pages/layouts/**",
      "!src/pages/macros/**"
    ])
    .pipe(data(() => yaml.safeLoad(fs.readFileSync("src/data/data.yml"))))
    .pipe(nunjucksRender({ path: "src/pages", watch: false }))
    .pipe(
      beautify({
        html: {
          indent_size: 2,
          indent_char: " ",
          max_preserve_newlines: 1
        }
      })
    )
    .pipe(gulp.dest(PATHS.docs));
}

// Copy files from the "src/assets" folder
// but skips the "img", "js", and "scss" folder
function copyAssets() {
  return gulp
    .src(PATHS.assets, { nodir: true })
    .pipe(gulp.dest(`${PATHS.docs}/assets`));
}

// Copy static files to "docs" folder
function copyStaticFiles() {
  return gulp
    .src(PATHS.staticFiles, { allowEmpty: true })
    .pipe(gulp.dest(PATHS.docs));
}

// Copy static files to "docs" folder
function copyFilesToRoot() {
  return gulp
    .src(PATHS.rootFiles, { allowEmpty: true })
    .pipe(gulp.dest(PATHS.docs));
}

// Copy images
// In production images are compressed
function images() {
  return gulp
    .src(PATHS.images)
    .pipe(
      gulpif(
        PRODUCTION,
        imagemin([
          imageminGifsicle({ interlaced: true, optimizationLevel: 3 }),
          imageminMozjpeg({ quality: 80 }),
          imageminPngquant({ quality: [0.5, 0.8] }),
          imagemin.svgo({
            plugins: [{ removeViewBox: true }, { cleanupIDs: false }]
          })
        ])
      )
    )
    .pipe(gulp.dest(`${PATHS.docs}/assets`));
}

// Start a server with Browsersync
function server(done) {
  browserSync.init(
    {
      server: PATHS.docs,
      port: PORT,
      open: false
    },
    done
  );
}
// Reload the browser with Browsersync
function liveReload(done) {
  browserSync.reload();
  done();
}

// Watch for file changes and run tasks
function watchFiles(done) {
  gulp.watch(PATHS.assets, copyAssets);
  gulp.watch(PATHS.staticFiles, copyStaticFiles);
  gulp.watch(PATHS.rootFiles, copyFilesToRoot);
  gulp.watch("src/assets/scss/**/*.scss", gulp.series(css, liveReload));
  gulp.watch("src/assets/js/**/*.js", gulp.series(js, liveReload));
  gulp.watch("src/assets/img/**/*", gulp.series(images, liveReload));
  gulp.watch(
    ["src/pages/**/*.html", "src/data/**/*.yml"],
    gulp.series(html, liveReload)
  );
  done();
}

// Export tasks which can be used later with "gulp taskname"
exports.cleanUp = cleanUp;
exports.development = gulp.series(
  cleanUp,
  gulp.parallel(
    html,
    copyAssets,
    copyStaticFiles,
    copyFilesToRoot,
    images,
    css,
    js
  ),
  server,
  watchFiles
);
exports.build = gulp.series(
  cleanUp,
  stylelint,
  eslint,
  gulp.parallel(
    copyAssets,
    copyStaticFiles,
    copyFilesToRoot,
    images,
    html,
    css,
    js
  ),
  criticalCSS,
  cleanUnusedCSS,
  revFiles,
  compressAssets
);

// TeXworksScript
// Title: Errors, warnings, badboxes
// Description: Looks for errors, warnings or badboxes in the LaTeX terminal output
// Author: Jonathan Kew, Stefan Löffler, Antonio Macrì, Henrik Skov Midtiby
// Version: 0.8.0
// Date: 2012-03-23
// Script-Type: hook
// Hook: AfterTypeset

/*
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */


// Should be set equal to the environment variable max_print_line
const max_print_line = 79;

// String.trim() and String.trimLeft() were introduced in Qt 4.7
if(typeof(String.prototype.trim) == "undefined")
{
  String.prototype.trim = (function() {
    var re = /^[\s\n]+|[\s\n]+$/g;
    return function() { return this.replace(re, ""); };
  })();
}

if(typeof(String.prototype.trimLeft) == "undefined")
{
  String.prototype.trimLeft = (function() {
    var re = /^[\s\n]+/;
    return function() { return this.replace(re, ""); };
  })();
}

if(typeof(String.prototype.trimRight) == "undefined")
{
  String.prototype.trimRight = (function() {
    var re = /[\s\n]+$/;
    return function() { return this.replace(re, ""); };
  })();
}

// Enums
var Severity = { BadBox:0, Warning:1, Error:2 };
var SortBy = { Severity:0, Occurrence:1 };

// Constructor
function Result(s, f, r, d)
{
  this.Severity = s;
  this.File = f;
  this.Row = r;
  this.Description = d;
}

Result.Equals = function(a, b)
{
  return a.Severity == b.Severity && a.File == b.File &&
         a.Row == b.Row && a.Description == b.Description;
}

// Constructor
function LogParser()
{
  this.Patterns = [
    {
      // This pattern is similar to the next one: this reads another
      // line after "l.\d" (for errors such as "Undefined control sequence").
      Regex: new RegExp("^!\\s+((?:.*\n)+?(l\\.(\\d+).*)\n(\\s+).*)\n"),
      Callback: function(m, f) {
        return m[4].length == m[2].length ? new Result(Severity.Error, f, m[3], m[1]) : null;
      }
    },
    {
      // This pattern recognizes all errors generated with \errmessage,
      // that is, starting with "!" and containing "l.\d+".
      // The macro \GenericError uses \errmessage internally.
      // Macros \@latex@error and \(Class|Package)Error use \GenericError.
      Regex: new RegExp("^!\\s+((?:.*\n)+?l\\.(\\d+)\\s(?:.*\\S.*\n)?)"),
      Callback: function(m, f) {
        return new Result(Severity.Error, f, m[2], m[1].trim());
      }
    },
    {
      // This pattern matches critical errors:
      // "File ended while scanning use|definition of ...",
      // "Missing \begin{document}.", "Emergency stop."
      Regex: new RegExp("^!\\s+(.+)\n"),
      Callback: function(m, f) {
        return new Result(Severity.Error, f, 0, m[1]);
      }
    },
    {
      // This pattern matches all warnings generated with \(Class|Package)(Warning|WarningNoLine).
      // Additionally, it recognizes other warnings like "LaTeX Font Warning: ...\n(Font) ...".
      // The macro \GenericWarning does not produce formatted output, so it is impossible
      // to match it. We need to look for output generated by higher level commands.
      Regex: new RegExp("^((?:Class|Package|LaTeX) ([^\\s]+) Warning: .+\n)(?:\\(\\2\\)\\s([^\n]+)\n)*(?!\\(\\2\\))"),
      Callback: function(m, f) {
        // We remove "\n(<name>) " from description:
        var desc = m[0].replace(new RegExp("\\(" + m[2] + "\\)\\s([^\n]+)\n", "g"), " $1 ").replace(/\s+/g, " ").trim();
        var row = /on input line (\d+)\./.exec(m[0]);
        return new Result(Severity.Warning, f, row ? row[1] : 0, desc);
      }
    },
    {
      // This pattern matches all warnings generated using \@latex@warning and  \@latex@warning@no@line
      // (which add a little formatting before resorting to \GenericWarning).
      // Warnings generated this way should use \MessageBreak, but sometimes they don't, so we read until we find
      // a dot followed by a newline.
      Regex: new RegExp("^LaTeX Warning: (?:(?!\\.\n).|\n)+\\.\n"),
      Callback: function(m, f) {
        m[0] = m[0].replace(/\n/g, "").trim();
        var row = /on input line (\d+)\./.exec(m[0]);
        return new Result(Severity.Warning, f, row ? row[1] : 0, m[0]);
      }
    },
    {
      // This pattern recognizes badboxes on one, two or more lines.
      Regex: new RegExp("^((?:Under|Over)full \\\\[hv]box\\s*\\([^)]+\\) in paragraph at lines (\\d+)--\\d+\n)((?:.{" + max_print_line + "}\n)*)(.+)"),
      Callback: function(m, f) {
        return new Result(Severity.BadBox, f, m[2], m[1] + m[3].replace(/\n/g, '') + m[4].trimRight());
      }
    }
  ];

  this.Settings = {
    SortBy: SortBy.Severity,
    MinSeverity: Severity.BadBox
  };
}


LogParser.prototype.Parse = function(output, rootFileName)
{
  var skipRegexp = new RegExp("^[^\n\r()]+");
  var currentFile = undefined, fileStack = [], extraParens = 0;

  // Generate or clear old results
  this.Results = [];

  while (output.length > 0) {
    // Be sure to remove any whitespace at the beginning of the string
    output = output.trimLeft();

    // Text matched by some patterns (especially badboxes) may contain
    // unbalanced parenthesis: we'd better look for every pattern, to
    // gobble such text and avoid those parenthesis conflict with the
    // file stack.
    for (var i = 0, len = this.Patterns.length; i < len; ) {
      var match = this.Patterns[i].Regex.exec(output);
      if (match) {
        var result = this.Patterns[i].Callback(match, currentFile);
        if (result) {
          if (result.Severity >= this.Settings.MinSeverity) {
            // Here we filter desired results
            this.Results.push(result);
          }
          // Always trimLeft before looking for a pattern
          output = output.slice(match[0].length).trimLeft();
          i = 0;
          continue;
        }
      }
      i++;
    }

    // Go to the first parenthesis or simply skip the first line
    var match = skipRegexp.exec(output);
    if (match) {
      output = output.slice(match[0].length);
    }
    if (output.charAt(0) == ")") {
      if (extraParens > 0)
        extraParens--;
      else if (fileStack.length > 0)
        currentFile = fileStack.pop();
      output = output.slice(1);
    }
    else if (output.charAt(0) == "(") {
      var result = LogParser.MatchNewFile(output, rootFileName);
      if (result) {
        fileStack.push(currentFile);
        currentFile = result.File;
        output = result.Output;
        extraParens = 0;
      }
      else {
        extraParens++;
        output = output.slice(1);
      }
    }

    this.CheckForRerunOfLatex(output);
  }
  this.WarnAuxFiles();
}


LogParser.MatchNewFile = (function()
{
  // Should catch filenames of the following forms:
  //  * ./abc, "./abc"
  //  * /abc, "/abc"
  //  * .\abc, ".\abc"
  //  * C:\abc, "C:\abc"
  //  * \\server\abc, "\\server\abc"
  var fileRegexp = new RegExp('^\\("((?:\\./|/|\\.\\\\|[a-zA-Z]:\\\\|\\\\\\\\)(?:[^"]|\n)+)"|^\\(((?:\\./|/|\\.\\\\|[a-zA-Z]:\\\\|\\\\\\\\)[^ ()\n]+)');
  var fileContinuingRegexp = new RegExp('[/\\\\ ()\n]');
  var filenameRegexp = new RegExp("[^\\.]\\.[a-zA-Z0-9]{1,4}$");
  function getBasePath(path) {
    var i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return (i == -1) ? path : path.slice(0, i+1);
  }
  // Non-ASCII chars occupy more than one byte: the compiler
  // breaks after 79 *bytes*, not chars!
  function getLengthInBytes(s) {
    var r = s.length;
    for (var k = 0, l = r; k < l; k++) {
      if (s.charCodeAt(k) <= 0x7F) continue;
      else if (s.charCodeAt(k) <= 0x7FF) r+=1;
      else if (s.charCodeAt(k) <= 0xFFFF) r+=2;
      else r+=3;
    }
    return r;
  }
  const EXISTS = 0;
  const MAYEXIST = 2;
  const DOESNTEXIST = 1;
  // The algorithm works as follows.
  // If the path starts with a quote ("), we are on MiKTeX and the path contains spaces.
  // We just have to read until the next \".
  // Otherwise, we use a double approach: first, we rely on TW.fileExists; second, we
  // check the length of the line. TW.fileExists can return the actual response (EXISTS,
  // DOESNTEXIST) or not (MAYEXIST). Counting the length of the line can be useful to
  // recognize files on multiple lines: a file can continue on the next line only if
  // has been reached the end of the current line.
  // If we know for sure if the file exists, we return an appropriate result.
  // Otherwise we guess if it can be a valid filename, possibly spanning on multiple
  // lines, and remember such candidate when looking ahead for additional chunks.
  return function (output,rootFileName) {
    rootFileName = rootFileName || "";
    var match = fileRegexp.exec(output);
    if (match) {
      output = output.slice(match[0].length);
      if (typeof(match[2]) != "undefined") {
        var basePath = match[2][0] == '.' ? getBasePath(rootFileName) : "";
        var m, svmatch = null, svoutput = null;
        // We ignore preceeding characters in the same line, and simply consider
        // max_print_line: filenames which start in the middle of a line never
        // continue on the next line.
        var len = getLengthInBytes(match[0]);
        while (m = fileContinuingRegexp.exec(output)) {
          var sepPos = output.indexOf(m[0]);
          var chunk = output.slice(0, sepPos);
          match[2] += chunk;
          len += getLengthInBytes(chunk);
          if (m[0] == '(' || m[0] == ')') {
            output = output.slice(sepPos);
            break;
          }
          output = output.slice(sepPos + 1);
          var existence = TW.fileExists(basePath + match[2]);
          if (m[0] == '/' || m[0] == '\\') {
            if (existence == DOESNTEXIST)
              return null;
          }
          else {
            if (existence == EXISTS)
              break;
            if (existence == MAYEXIST && filenameRegexp.test(match[2])) {
              svmatch = match[2];
              svoutput = output;
            }
          }
          if (m[0] != '\n') {
            match[2] += m[0];
            len++;
          }
          else if (len % max_print_line) {
            if (existence == DOESNTEXIST)
              return null;
            if (!filenameRegexp.test(match[2])) {
              if (!svmatch)
                return null;
              match[2] = svmatch;
              output = svoutput;
            }
            break;
          }
        }
        // trimRight to remove possible spaces before an opening parenthesis
        match[2] = match[2].trimRight();
      }
      else {
        match[1] = match[1].replace(/\n/g, '');
      }
      return { Output: output, File: (match[1] || match[2])};
    }
    return null;
  };
})();


LogParser.prototype.CheckForRerunOfLatex = (function()
{
  var latexmkApplyingRule = new RegExp("^Latexmk: applying rule \'(.*)\'");
  return function(output) {
    if (latexmkApplyingRule.exec(output)) {
      this.Results = [];
    }
  };
})();


LogParser.prototype.WarnAuxFiles = function()
{
  for (var i = this.Results.length-1; i > 0; i--) {
    if (this.Results[i].Description.indexOf("File ended while scanning use of") > -1) {
      if (TW.question(null, "", "While typesetting, a corrupt .aux " +
        "file from a previous run was detected. You should remove " +
        "it and rerun the typesetting process. Do you want to display" +
        "the \"Remove Aux Files...\" dialog now?", 0x14000) == 0x4000)
        TW.target.removeAuxFiles();
      break;
    }
  }
}


LogParser.prototype.GenerateReport = function(onlyTable)
{
  if (this.Results.length > 0) {
    var counters = [ 0, 0, 0 ];
    var html = "<table border='0' cellspacing='0' cellpadding='4'>";
    if (this.Settings.SortBy == SortBy.Severity) {
      var htmls = [ "", "", "" ];
      for(var i = 0, len = this.Results.length; i < len; i++) {
        var result = this.Results[i];
        htmls[result.Severity] += LogParser.GenerateResultRow(result);
        counters[result.Severity]++;
      }
      html += htmls.reverse().join("");
    }
    else {
      for(var i = 0, len = this.Results.length; i < len; i++) {
        var result = this.Results[i];
        html += LogParser.GenerateResultRow(result);
        counters[result.Severity]++;
      }
    }
    html += "</table>";
    if (!onlyTable) {
      var h = "<html><body>";
      h += "Errors: " + counters[Severity.Error] +
           ", Warnings: " + counters[Severity.Warning] +
           ", Bad boxes: " + counters[Severity.BadBox] + "<hr/>";
      h += html;
      h += "</body></html>";
      html = h;
    }
    return html;
  }
  else {
    return null;
  }
}


LogParser.EscapeHtml = function(str)
{
  var html = str;
  html = html.replace(/&/g, "&amp;");
  html = html.replace(/</g, "&lt;");
  html = html.replace(/>/g, "&gt;");
  html = html.replace(/\n /g, "\n&nbsp;");
  html = html.replace(/  /g, "&nbsp;&nbsp;");
  html = html.replace(/&nbsp; /g, "&nbsp;&nbsp;");
  return html.replace(/\n/g, "<br />\n");
}


LogParser.GenerateResultRow = (function()
{
  var colors = [ "#8080FF", "#F8F800", "#F80000" ];
  var getFilename = new RegExp("[^\\\\/]+$");
  return function(result) {
    var html = '';
    var color = colors[result.Severity];
    var file = "&#8212;";
    if (typeof(result.File) != "undefined") {
      file = "<a href='texworks:" + encodeURI(result.File) +
             (result.Row ? '#' + result.Row : '') + "'>" +
             getFilename.exec(result.File)[0] + "</a>";
    }
    html += '<tr>';
    html += '<td style="background-color: ' + color + '"></td>';
    html += '<td valign="top">' + file + '</td>';
    html += '<td valign="top">' + (result.Row || '') + '</td>';
    html += '<td valign="top">' + LogParser.EscapeHtml(result.Description) + '</td>';
    html += '</tr>';
    return html;
  };
})();



// We allow other scripts to use and reconfigure this parser
if (typeof(justLoad) == "undefined") {
  var parser = new LogParser();
  parser.Parse(TW.target.consoleOutput, TW.target.rootFileName);
  TW.result = parser.GenerateReport();
}
undefined;

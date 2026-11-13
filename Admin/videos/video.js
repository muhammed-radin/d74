var pageTkn = false;

function reloadVD() {
  db.getYTchannelVideos(function (xhr) {
    var res = null;
    try {
      res = xhr && typeof xhr.json === "function" ? xhr.json() : JSON.parse(xhr.response);
    } catch (_) {}

    if (document.querySelector('.loader-bg')) {
      document.querySelector('.loader-bg').style.display = 'none';
    }

    if (!res || !Array.isArray(res.items)) {
      document.querySelector('.body').innerHTML +=
        '<div class="empty-state" style="width:100%"><ion-icon name="cloud-offline-outline"></ion-icon>' +
        '<h3>Could not load videos</h3><p>The YouTube service did not respond. Try refreshing.</p></div>';
      return;
    }

    res.items.forEach(function (data, index) {
      var id = 'ID_10' + index;
      var code = old_card_ui.create(data, id);
      document.querySelector('.body').innerHTML += code;
    });

    if (res.nextPageToken) {
      pageTkn = res.nextPageToken;
      document.querySelector('.load23').innerHTML +=
        '<button id="q43" class="btn btn-ghost btn-block" onclick="document.getElementById(\'q43\').remove();reloadVD()">Load more</button>';
    }
  }, pageTkn);
}

reloadVD();

function openOptions(id) {
  var elem = document.getElementById(id);
  if (elem) elem.style.display = 'block';
}

function closeOptions(id) {
  var elem = document.getElementById(id);
  if (elem) elem.style.display = 'none';
}

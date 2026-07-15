/* ===================== Naqsha Ghar AI - script.js ===================== */
/* M Ijaz - GHS 124/NB */

(function(){
  'use strict';

  /* ---------- Room type definitions ---------- */
  var ROOM_TYPES = {
    bedroom:  {label:'Bedroom',      emoji:'🛏️', weight:14, color:'#ffd9a3'},
    kitchen:  {label:'Kitchen',      emoji:'🍳', weight:9,  color:'#c8f2c0'},
    washroom: {label:'Washroom',     emoji:'🚿', weight:4,  color:'#aee0ff'},
    stairs:   {label:'Stairs',       emoji:'🪜', weight:5,  color:'#d8d8d8'},
    tvlounge: {label:'TV Lounge',    emoji:'📺', weight:11, color:'#ffc2e0'},
    drawing:  {label:'Drawing Room', emoji:'🛋️', weight:12, color:'#ffe98a'},
    guest:    {label:'Guest Room',   emoji:'🛌', weight:11, color:'#d3c2ff'},
    carpark:  {label:'Car Park',     emoji:'🚗', weight:0,  color:'#cfcfcf', special:true}
  };
  var ROOM_ORDER = ['bedroom','kitchen','washroom','stairs','tvlounge','drawing','guest','carpark'];
  var DEFAULT_QTY = {bedroom:3, kitchen:1, washroom:2, stairs:1, tvlounge:1, drawing:1, guest:1, carpark:1};

  var SQFT_PER_MARLA = 225; /* standard approximation used in Pakistan */

  /* ---------- State ---------- */
  var state = {
    marla: 10,
    dims: {front:30, back:30, left:75, right:75},
    stories: 1,
    qty: Object.assign({}, DEFAULT_QTY),
    floors: [],      /* generated floor layouts */
    currentFloor: 0
  };

  /* ---------- DOM refs ---------- */
  var $ = function(id){ return document.getElementById(id); };
  var setupView = $('setupView');
  var resultView = $('resultView');
  var savedView = $('savedView');
  var canvas = $('mapCanvas');
  var ctx = canvas.getContext('2d');

  /* ---------- Init room list UI ---------- */
  function buildRoomList(){
    var wrap = $('roomList');
    wrap.innerHTML = '';
    ROOM_ORDER.forEach(function(key){
      var rt = ROOM_TYPES[key];
      var qty = state.qty[key] || 0;
      var item = document.createElement('div');
      item.className = 'room-item' + (qty>0 ? ' selected' : '');
      item.dataset.key = key;
      item.innerHTML =
        '<div class="room-info">' +
          '<span class="room-emoji">'+rt.emoji+'</span>' +
          '<span class="room-name">'+rt.label+'</span>' +
        '</div>' +
        '<div class="room-qty-ctrl">' +
          '<button class="qty-btn" data-act="dec">−</button>' +
          '<span class="qty-val">'+qty+'</span>' +
          '<button class="qty-btn" data-act="inc">+</button>' +
        '</div>';
      wrap.appendChild(item);
    });
  }

  function changeQty(key, delta){
    var max = key === 'carpark' || key === 'kitchen' || key === 'stairs' ? 2 : 6;
    var val = (state.qty[key]||0) + delta;
    if (val < 0) val = 0;
    if (val > max) val = max;
    state.qty[key] = val;
    buildRoomList();
  }

  $('roomList').addEventListener('click', function(e){
    var btn = e.target.closest('.qty-btn');
    if(!btn) return;
    var item = e.target.closest('.room-item');
    var key = item.dataset.key;
    changeQty(key, btn.dataset.act === 'inc' ? 1 : -1);
  });

  /* ---------- Marla chips ---------- */
  var marlaToDims = {
    3:  {front:22, back:22, left:60, right:60},
    5:  {front:25, back:25, left:45, right:45},
    7:  {front:30, back:30, left:52.5, right:52.5},
    10: {front:30, back:30, left:75, right:75},
    14: {front:35, back:35, left:81, right:81},
    20: {front:40, back:40, left:112.5, right:112.5}
  };

  $('marlaChips').addEventListener('click', function(e){
    var chip = e.target.closest('.chip');
    if(!chip) return;
    Array.prototype.forEach.call($('marlaChips').children, function(c){ c.classList.remove('active'); });
    chip.classList.add('active');
    var m = chip.dataset.marla;
    if (m === 'custom'){
      $('areaHint').textContent = 'Custom size — Length/Width neechay set karein';
      return;
    }
    state.marla = parseFloat(m);
    var d = marlaToDims[m];
    if (d){
      state.dims = Object.assign({}, d);
      syncDimInputs();
    }
    updateAreaHint();
  });

  function updateAreaHint(){
    var area = ((state.dims.front+state.dims.back)/2) * ((state.dims.left+state.dims.right)/2);
    var marlaCalc = (area/SQFT_PER_MARLA).toFixed(1);
    $('areaHint').textContent = 'Plot Area: ~'+Math.round(area)+' sq.ft (~'+marlaCalc+' Marla)';
  }

  function syncDimInputs(){
    $('dimFront').value = state.dims.front;
    $('dimBack').value = state.dims.back;
    $('dimLeft').value = state.dims.left;
    $('dimRight').value = state.dims.right;
  }

  /* ---------- Dimension steppers ---------- */
  document.querySelectorAll('.step-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var dim = btn.dataset.dim;
      var op = btn.dataset.op;
      var delta = op === '+' ? 1 : -1;
      state.dims[dim] = Math.max(8, (state.dims[dim]||10) + delta);
      syncDimInputs();
      updateAreaHint();
    });
  });
  ['front','back','left','right'].forEach(function(dim){
    var input = $('dim'+dim.charAt(0).toUpperCase()+dim.slice(1));
    input.addEventListener('input', function(){
      var v = parseFloat(input.value);
      if (!isNaN(v) && v > 0){
        state.dims[dim] = v;
        updateAreaHint();
      }
    });
  });

  /* ---------- Stories chips ---------- */
  $('storyChips').addEventListener('click', function(e){
    var chip = e.target.closest('.chip');
    if(!chip) return;
    Array.prototype.forEach.call($('storyChips').children, function(c){ c.classList.remove('active'); });
    chip.classList.add('active');
    state.stories = parseInt(chip.dataset.story, 10);
  });

  /* ===================== Layout Algorithm ===================== */

  /* Recursive guillotine slicing - balances rooms into a rectangle by weight */
  function sliceLayout(x, y, w, h, rooms){
    if (rooms.length === 0) return;
    if (rooms.length === 1){
      rooms[0].rect = {x:x, y:y, w:w, h:h};
      return;
    }
    var total = rooms.reduce(function(s,r){ return s + r.weight; }, 0);
    var target = total/2;
    var acc = 0, idx = 1;
    for (var i=0; i<rooms.length; i++){
      acc += rooms[i].weight;
      if (acc >= target){ idx = i+1; break; }
    }
    idx = Math.max(1, Math.min(rooms.length-1, idx));
    var groupA = rooms.slice(0, idx);
    var groupB = rooms.slice(idx);
    var wA = groupA.reduce(function(s,r){ return s+r.weight; }, 0);
    var wB = groupB.reduce(function(s,r){ return s+r.weight; }, 0);
    var ratio = wA/(wA+wB);

    if (w >= h){
      var wLen = w * ratio;
      sliceLayout(x, y, wLen, h, groupA);
      sliceLayout(x+wLen, y, w-wLen, h, groupB);
    } else {
      var hLen = h * ratio;
      sliceLayout(x, y, w, hLen, groupA);
      sliceLayout(x, y+hLen, w, h-hLen, groupB);
    }
  }

  function makeRoomInstances(qtyMap, keys){
    var list = [];
    keys.forEach(function(key){
      var n = qtyMap[key] || 0;
      for (var i=0; i<n; i++){
        var rt = ROOM_TYPES[key];
        list.push({
          key:key,
          label: n>1 ? rt.label+' '+(i+1) : rt.label,
          emoji: rt.emoji,
          color: rt.color,
          weight: rt.weight
        });
      }
    });
    return list;
  }

  /* Distributes rooms across floors and runs the slicing algorithm for each */
  function generateFloors(){
    var avgW = (state.dims.front + state.dims.back) / 2;   /* plot width */
    var avgL = (state.dims.left + state.dims.right) / 2;    /* plot depth */

    var carparkDepth = state.qty.carpark > 0 ? Math.min(18, avgL*0.22) : 0;
    var houseDepth = avgL - carparkDepth;

    var floors = [];
    var qty = Object.assign({}, state.qty);

    if (state.stories === 1){
      var keys = ROOM_ORDER.filter(function(k){ return k!=='carpark'; });
      var rooms = makeRoomInstances(qty, keys);
      if (rooms.length === 0) rooms = [{key:'drawing', label:'Room', emoji:'🏠', color:'#eee', weight:1}];
      sliceLayout(0, 0, avgW, houseDepth, rooms);
      floors.push({name:'Ground Floor', rooms:rooms, carpark: state.qty.carpark>0, carparkDepth:carparkDepth, w:avgW, l:avgL, houseDepth:houseDepth});
    } else {
      /* Ground floor: social rooms */
      var groundKeys = ['drawing','guest','kitchen','tvlounge'];
      var groundQty = {
        drawing: qty.drawing,
        guest: qty.guest,
        kitchen: qty.kitchen,
        tvlounge: qty.tvlounge
      };
      var groundStairs = qty.stairs > 0 ? 1 : 0;
      var groundWash = qty.washroom > 0 ? 1 : 0;
      var groundRooms = makeRoomInstances(groundQty, groundKeys);
      if (groundStairs) groundRooms.push({key:'stairs', label:'Stairs', emoji:ROOM_TYPES.stairs.emoji, color:ROOM_TYPES.stairs.color, weight:ROOM_TYPES.stairs.weight});
      if (groundWash) groundRooms.push({key:'washroom', label:'Washroom', emoji:ROOM_TYPES.washroom.emoji, color:ROOM_TYPES.washroom.color, weight:ROOM_TYPES.washroom.weight});
      if (groundRooms.length === 0) groundRooms = [{key:'drawing', label:'Hall', emoji:'🏠', color:'#eee', weight:1}];
      sliceLayout(0, 0, avgW, houseDepth, groundRooms);
      floors.push({name:'Ground Floor', rooms:groundRooms, carpark: state.qty.carpark>0, carparkDepth:carparkDepth, w:avgW, l:avgL, houseDepth:houseDepth});

      /* Upper floors: bedrooms + remaining washrooms */
      var upperCount = state.stories - 1;
      var remBedrooms = qty.bedroom || 0;
      var remWash = Math.max(0, (qty.washroom||0) - groundWash);
      var remStairs = qty.stairs > 0 ? 1 : 0;

      for (var f=0; f<upperCount; f++){
        var bedThisFloor = Math.ceil((remBedrooms - f*Math.ceil(remBedrooms/upperCount)) > 0 ? Math.ceil(remBedrooms/upperCount) : 0);
        bedThisFloor = Math.min(bedThisFloor, remBedrooms);
        remBedrooms -= bedThisFloor;
        var washThisFloor = f === upperCount-1 ? remWash : Math.round(remWash/upperCount);
        remWash -= washThisFloor;

        var floorRooms = [];
        for (var b=0; b<bedThisFloor; b++){
          floorRooms.push({key:'bedroom', label:'Bedroom '+(b+1), emoji:ROOM_TYPES.bedroom.emoji, color:ROOM_TYPES.bedroom.color, weight:ROOM_TYPES.bedroom.weight});
        }
        for (var w2=0; w2<washThisFloor; w2++){
          floorRooms.push({key:'washroom', label:'Washroom '+(w2+1), emoji:ROOM_TYPES.washroom.emoji, color:ROOM_TYPES.washroom.color, weight:ROOM_TYPES.washroom.weight});
        }
        if (remStairs){
          floorRooms.push({key:'stairs', label:'Stairs', emoji:ROOM_TYPES.stairs.emoji, color:ROOM_TYPES.stairs.color, weight:ROOM_TYPES.stairs.weight});
        }
        if (floorRooms.length === 0){
          floorRooms.push({key:'guest', label:'Store Room', emoji:'📦', color:'#eee', weight:1});
        }
        sliceLayout(0, 0, avgW, avgL, floorRooms);
        floors.push({name:'Floor '+(f+1), rooms:floorRooms, carpark:false, carparkDepth:0, w:avgW, l:avgL, houseDepth:avgL});
      }
    }
    return floors;
  }

  /* ===================== Canvas Rendering ===================== */

  var PADDING = 40;
  var SCALE = 6; /* px per foot, recalculated dynamically */

  function drawFloor(floor){
    var w = floor.w, l = floor.l;
    var availW = 900 - PADDING*2;
    var availH = 900 - PADDING*2;
    SCALE = Math.min(availW/w, availH/l);
    if (SCALE > 14) SCALE = 14;

    var cw = w*SCALE + PADDING*2;
    var ch = l*SCALE + PADDING*2;
    canvas.width = cw;
    canvas.height = ch;

    ctx.clearRect(0,0,cw,ch);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0,0,cw,ch);

    var ox = PADDING, oy = PADDING;

    /* Car park strip (front) */
    var innerTop = oy;
    if (floor.carpark && floor.carparkDepth > 0){
      var cpH = floor.carparkDepth*SCALE;
      ctx.fillStyle = ROOM_TYPES.carpark.color;
      ctx.fillRect(ox, oy, w*SCALE, cpH);
      strokeRoom(ox, oy, w*SCALE, cpH);
      labelRoom(ox, oy, w*SCALE, cpH, ROOM_TYPES.carpark.emoji, 'Car Park', floor.carparkDepth+'ft x '+w.toFixed(0)+'ft');
      innerTop = oy + cpH;
    }

    /* Rooms */
    floor.rooms.forEach(function(r){
      var rx = ox + r.rect.x*SCALE;
      var ry = innerTop + r.rect.y*SCALE;
      var rw = r.rect.w*SCALE;
      var rh = r.rect.h*SCALE;
      ctx.fillStyle = r.color;
      ctx.fillRect(rx, ry, rw, rh);
      strokeRoom(rx, ry, rw, rh);
      labelRoom(rx, ry, rw, rh, r.emoji, r.label, r.rect.w.toFixed(1)+'ft x '+r.rect.h.toFixed(1)+'ft');
    });

    /* Outer boundary */
    ctx.strokeStyle = '#1e2a24';
    ctx.lineWidth = 3;
    ctx.strokeRect(ox, oy, w*SCALE, l*SCALE);

    /* Side dimension labels */
    ctx.fillStyle = '#1e2a24';
    ctx.font = 'bold 13px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Front: '+state.dims.front+'ft', ox + (w*SCALE)/2, oy - 14);
    ctx.fillText('Back: '+state.dims.back+'ft', ox + (w*SCALE)/2, oy + l*SCALE + 26);

    ctx.save();
    ctx.translate(ox - 14, oy + (l*SCALE)/2);
    ctx.rotate(-Math.PI/2);
    ctx.fillText('Left: '+state.dims.left+'ft', 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(ox + w*SCALE + 14, oy + (l*SCALE)/2);
    ctx.rotate(Math.PI/2);
    ctx.fillText('Right: '+state.dims.right+'ft', 0, 0);
    ctx.restore();

    /* North arrow */
    ctx.save();
    ctx.translate(cw-28, 30);
    ctx.strokeStyle = '#1e2a24';
    ctx.fillStyle = '#1e2a24';
    ctx.beginPath();
    ctx.moveTo(0,-14); ctx.lineTo(7,10); ctx.lineTo(0,4); ctx.lineTo(-7,10); ctx.closePath();
    ctx.fill();
    ctx.font = '10px sans-serif';
    ctx.fillText('N', 0, 22);
    ctx.restore();

    /* Title */
    ctx.textAlign = 'left';
    ctx.font = 'bold 15px Segoe UI, sans-serif';
    ctx.fillStyle = '#12492a';
    ctx.fillText('Naqsha Ghar AI — '+floor.name, 6, 16);

    /* Watermark */
    ctx.textAlign = 'right';
    ctx.font = 'italic 12px Segoe UI, sans-serif';
    ctx.fillStyle = 'rgba(30,42,36,0.55)';
    ctx.fillText('M Ijaz', cw-6, ch-6);
  }

  function strokeRoom(x,y,w,h){
    ctx.strokeStyle = 'rgba(30,42,36,0.6)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x,y,w,h);
  }

  function labelRoom(x,y,w,h,emoji,label,dims){
    var cx = x+w/2, cy = y+h/2;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#1e2a24';
    if (w>36 && h>30){
      ctx.font = (Math.min(18, w/6))+'px sans-serif';
      ctx.fillText(emoji, cx, cy-8);
      ctx.font = 'bold '+Math.min(12, w/9)+'px Segoe UI, sans-serif';
      ctx.fillText(label, cx, cy+8);
      if (h>50){
        ctx.font = Math.min(10, w/12)+'px Segoe UI, sans-serif';
        ctx.fillStyle = '#4a5a52';
        ctx.fillText(dims, cx, cy+22);
      }
    } else if (w>18 && h>18){
      ctx.font = '11px sans-serif';
      ctx.fillText(emoji, cx, cy+4);
    }
  }

  /* ---------- Floor tabs ---------- */
  function buildFloorTabs(){
    var wrap = $('floorTabs');
    wrap.innerHTML = '';
    state.floors.forEach(function(f, i){
      var tab = document.createElement('button');
      tab.className = 'floor-tab' + (i===state.currentFloor ? ' active' : '');
      tab.textContent = f.name;
      tab.addEventListener('click', function(){
        state.currentFloor = i;
        buildFloorTabs();
        drawFloor(state.floors[i]);
        buildLegend(state.floors[i]);
      });
      wrap.appendChild(tab);
    });
  }

  function buildLegend(floor){
    var wrap = $('legend');
    wrap.innerHTML = '';
    var seen = {};
    var items = floor.rooms.slice();
    if (floor.carpark) items.unshift({key:'carpark', label:'Car Park', color:ROOM_TYPES.carpark.color});
    items.forEach(function(r){
      if (seen[r.key]) return;
      seen[r.key] = true;
      var el = document.createElement('div');
      el.className = 'legend-item';
      el.innerHTML = '<span class="legend-swatch" style="background:'+r.color+'"></span>'+ (ROOM_TYPES[r.key]?ROOM_TYPES[r.key].label:r.label);
      wrap.appendChild(el);
    });
  }

  /* ===================== View switching ===================== */
  function showView(name){
    setupView.classList.add('hidden');
    resultView.classList.add('hidden');
    savedView.classList.add('hidden');
    if (name==='setup') setupView.classList.remove('hidden');
    if (name==='result') resultView.classList.remove('hidden');
    if (name==='saved') savedView.classList.remove('hidden');
  }

  function toast(msg){
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    setTimeout(function(){ t.classList.add('hidden'); }, 2200);
  }

  /* ---------- Generate button ---------- */
  $('generateBtn').addEventListener('click', function(){
    var totalRooms = Object.keys(state.qty).reduce(function(s,k){ return s + (k==='carpark'?0:state.qty[k]); }, 0);
    if (totalRooms === 0){
      toast('Kam az kam ek room select karein');
      return;
    }
    state.floors = generateFloors();
    state.currentFloor = 0;
    buildFloorTabs();
    drawFloor(state.floors[0]);
    buildLegend(state.floors[0]);
    showView('result');
  });

  $('regenBtn').addEventListener('click', function(){
    state.floors = generateFloors();
    state.currentFloor = Math.min(state.currentFloor, state.floors.length-1);
    buildFloorTabs();
    drawFloor(state.floors[state.currentFloor]);
    buildLegend(state.floors[state.currentFloor]);
    toast('Naya layout generate ho gaya');
  });

  $('backBtn').addEventListener('click', function(){ showView('setup'); });

  /* ---------- Download ---------- */
  $('downloadBtn').addEventListener('click', function(){
    var link = document.createElement('a');
    link.download = 'naqsha-ghar-'+Date.now()+'.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast('Naksha download ho gaya');
  });

  /* ---------- Share ---------- */
  $('shareBtn').addEventListener('click', function(){
    canvas.toBlob(function(blob){
      if (!blob) return;
      var file = new File([blob], 'naqsha-ghar.png', {type:'image/png'});
      if (navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
        navigator.share({
          title:'Naqsha Ghar AI',
          text:'Mera ghar ka naksha - Naqsha Ghar AI se banaya (M Ijaz)',
          files:[file]
        }).catch(function(){});
      } else {
        var link = document.createElement('a');
        link.download = 'naqsha-ghar.png';
        link.href = URL.createObjectURL(blob);
        link.click();
        toast('Share support nahi, download ho gaya');
      }
    }, 'image/png');
  });

  /* ---------- Save (localStorage) ---------- */
  var STORAGE_KEY = 'naqshaGharDesigns';

  function getSavedDesigns(){
    try{
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    }catch(e){ return []; }
  }
  function setSavedDesigns(list){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }

  $('saveBtn').addEventListener('click', function(){
    var list = getSavedDesigns();
    var thumb = canvas.toDataURL('image/png', 0.7);
    var roomsSummary = state.floors.reduce(function(s,f){ return s + f.rooms.length; }, 0);
    list.unshift({
      id: Date.now(),
      thumb: thumb,
      marla: state.marla,
      dims: Object.assign({}, state.dims),
      stories: state.stories,
      qty: Object.assign({}, state.qty),
      roomsCount: roomsSummary,
      date: new Date().toLocaleDateString()
    });
    if (list.length > 20) list = list.slice(0,20);
    setSavedDesigns(list);
    toast('Naksha save ho gaya ✅');
  });

  /* ---------- Saved designs view ---------- */
  function renderSavedList(){
    var wrap = $('savedList');
    var list = getSavedDesigns();
    wrap.innerHTML = '';
    if (list.length === 0){
      wrap.innerHTML = '<p class="hint">Abhi tak koi naksha save nahi hua.</p>';
      return;
    }
    list.forEach(function(item){
      var el = document.createElement('div');
      el.className = 'saved-item';
      el.innerHTML =
        '<img src="'+item.thumb+'" alt="Naksha">' +
        '<div class="saved-meta">' +
          '<h3>'+item.marla+' Marla • '+item.stories+' Story</h3>' +
          '<p>'+item.dims.front+'x'+item.dims.left+'ft • '+item.roomsCount+' Rooms • '+item.date+'</p>' +
        '</div>' +
        '<div class="saved-actions">' +
          '<button data-act="load" data-id="'+item.id+'">Load</button>' +
          '<button data-act="del" class="del" data-id="'+item.id+'">Delete</button>' +
        '</div>';
      wrap.appendChild(el);
    });
  }

  $('savedList').addEventListener('click', function(e){
    var btn = e.target.closest('button');
    if (!btn) return;
    var id = parseInt(btn.dataset.id, 10);
    var list = getSavedDesigns();
    if (btn.dataset.act === 'del'){
      list = list.filter(function(it){ return it.id !== id; });
      setSavedDesigns(list);
      renderSavedList();
      toast('Delete ho gaya');
    } else if (btn.dataset.act === 'load'){
      var item = list.find(function(it){ return it.id === id; });
      if (!item) return;
      state.marla = item.marla;
      state.dims = Object.assign({}, item.dims);
      state.stories = item.stories;
      state.qty = Object.assign({}, item.qty);
      syncDimInputs();
      updateAreaHint();
      buildRoomList();
      state.floors = generateFloors();
      state.currentFloor = 0;
      buildFloorTabs();
      drawFloor(state.floors[0]);
      buildLegend(state.floors[0]);
      showView('result');
    }
  });

  $('myDesignsBtn').addEventListener('click', function(){
    renderSavedList();
    showView('saved');
  });
  $('backFromSavedBtn').addEventListener('click', function(){ showView('setup'); });

  /* ---------- Service worker registration ---------- */
  if ('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('sw.js').catch(function(){});
    });
  }

  /* ---------- PWA install prompt ---------- */
  var deferredPrompt;
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    deferredPrompt = e;
  });

  /* ---------- Init ---------- */
  buildRoomList();
  syncDimInputs();
  updateAreaHint();

})();

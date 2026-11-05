(function (global) {
  const D = global.DOPANEWS = global.DOPANEWS || {};
  const descriptions = ['ボンバージャケット','ストリートジャケット','ビーニー','トラックスーツ','カジュアルスーツ','ロングコート','フーディー','バーシティジャケット','ユーティリティベスト','オーバーサイズニット','ワークジャケット','ジャンプスーツ'];
  const names = ['KENTA','REINA','SORA','HINA','TAKUMI','RIN','REN','MEI','RYO','YUNA','DAICHI','AKARI'];
  const characters = descriptions.map((description, i) => ({
    id: i + 1, name: names[i], description,
    image: './css/images/artist-' + String(i + 1).padStart(2, '0') + '-' + (i % 2 ? 'female' : 'male') + '.png'
  }));
  let chosen = [1, 2], open = false;
  D.getMcName = (speaker, battle) => {
    const ids = battle?.character_ids || chosen;
    return characters[ids[speaker === 'REINA' ? 1 : 0] - 1]?.name || speaker;
  };
  D.applyCharacterSelection = ids => {
    if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(id => characters.some(c => c.id === id))) return;
    chosen = ids.slice(); apply();
  };
  function apply() {
    ['kenta', 'reina'].forEach((side, index) => {
      const character = characters[chosen[index] - 1];
      document.documentElement.style.setProperty('--mc-' + side + '-image', 'url("' + character.image + '")');
      document.querySelectorAll('.mc-' + side + ' .mc-stage-portrait, .judge-character-' + side).forEach(image => { image.src = character.image; });
      document.querySelectorAll('.mc-' + side + ' .mc-name').forEach(label => { label.textContent = character.name; });
      document.querySelector('#btn-vote-' + side + ' .judge-tap-cta')?.replaceChildren(character.name);
    });
    D.selectedCharacters = chosen.slice();
  }
  global.addEventListener('DOMContentLoaded', () => {
    try {
      const saved = JSON.parse(localStorage.getItem('dopanews_characters_v1'));
      if (Array.isArray(saved) && saved.length === 2 && saved.every(id => characters.some(c => c.id === id)) && saved[0] !== saved[1]) chosen = saved;
    } catch {}
    apply();
  });
  D.showCharacterSelect = ({ title = '' } = {}) => {
    if (open) return Promise.resolve(false);
    open = true;
    return new Promise(resolve => {
      let side = 0;
      const draft = [null, null];
      const previousFocus = document.activeElement;
      const overlay = document.createElement('section');
      overlay.className = 'news-versus-cutin character-select';
      overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'MCキャラクター選択');
      overlay.innerHTML = '<div class="character-select-heading"><button type="button" class="character-select-back" aria-label="記事に戻る">〈 戻る</button><h1>SELECT MC</h1></div><div class="character-roster" role="group" aria-label="キャラクター一覧"></div><div class="character-preview" role="group" aria-label="左右のMC"><button type="button" class="character-slot" data-slot="0"><span>MIC A / KENTA</span><img alt=""/><strong></strong><small></small></button><span class="character-select-vs" aria-hidden="true">VS</span><button type="button" class="character-slot" data-slot="1"><span>MIC B / REINA</span><img alt=""/><strong></strong><small></small></button></div><button type="button" class="character-confirm">MC決定</button>';

      const roster = overlay.querySelector('.character-roster');
      let drag = null, suppressClick = false;
      function choose(id, target) {
        side = target;
        const other = 1 - side;
        if (draft[other] === id) draft[other] = draft[side];
        draft[side] = id; render();
      }
      function clearDrag() {
        if (!drag) return;
        drag.ghost?.remove();
        drag.button.classList.remove('character-drag-source');
        overlay.querySelectorAll('.character-drop-target').forEach(slot => slot.classList.remove('character-drop-target'));
        if (drag.button.hasPointerCapture(drag.pointerId)) drag.button.releasePointerCapture(drag.pointerId);
        drag = null;
      }
      characters.forEach(character => {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.character = character.id;
        button.setAttribute('aria-label', character.name + ' ' + character.description);
        const image = document.createElement('img'); image.src = character.image; image.alt = ''; image.draggable = false;
        const number = document.createElement('span'); number.textContent = character.name;
        button.append(image, number); roster.append(button);
        button.addEventListener('click', event => {
          if (suppressClick && event.detail !== 0) { event.preventDefault(); return; }
          choose(character.id, side);
        });
        button.addEventListener('pointerdown', event => {
          if (!event.isPrimary || event.button !== 0 || drag) return;
          suppressClick = false;
          drag = { button, pointerId:event.pointerId, x:event.clientX, y:event.clientY, ghost:null, target:null };
          button.setPointerCapture(event.pointerId);
        });
        button.addEventListener('pointermove', event => {
          if (!drag || drag.pointerId !== event.pointerId) return;
          if (!drag.ghost && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
          event.preventDefault(); suppressClick = true;
          if (!drag.ghost) {
            drag.ghost = document.createElement('img'); drag.ghost.className = 'character-drag-ghost';
            drag.ghost.src = character.image; drag.ghost.alt = ''; drag.ghost.setAttribute('aria-hidden','true');
            document.body.append(drag.ghost); button.classList.add('character-drag-source');
          }
          drag.ghost.style.left = event.clientX + 'px'; drag.ghost.style.top = event.clientY + 'px';
          const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-slot]');
          drag.target = target && overlay.contains(target) ? Number(target.dataset.slot) : null;
          overlay.querySelectorAll('[data-slot]').forEach(slot => slot.classList.toggle('character-drop-target', Number(slot.dataset.slot) === drag.target));
        });
        button.addEventListener('pointerup', event => {
          if (!drag || drag.pointerId !== event.pointerId) return;
          const target = drag.target, moved = Boolean(drag.ghost);
          clearDrag();
          if (moved && target !== null) choose(character.id, target);
        });
        button.addEventListener('pointercancel', clearDrag);
        button.addEventListener('lostpointercapture', () => { if (drag?.button === button) clearDrag(); });
      });
      function render() {

        overlay.querySelectorAll('[data-character]').forEach(button => {
          const id = Number(button.dataset.character);
          button.dataset.team = draft[0] === id ? 'a' : draft[1] === id ? 'b' : '';
          button.setAttribute('aria-pressed', String(draft[side] === id));
        });
        overlay.querySelectorAll('[data-slot]').forEach(button => {
          const index = Number(button.dataset.slot), character = characters[draft[index] - 1];
          button.setAttribute('aria-pressed', String(side === index));
          button.querySelector('span').textContent = 'MIC ' + (index === 0 ? 'A' : 'B');
          const image = button.querySelector('img'); image.hidden = !character;
          if (character) image.src = character.image; else image.removeAttribute('src');
          button.querySelector('strong').textContent = character?.name || '';
          button.querySelector('small').textContent = '';
        });
        overlay.querySelector('.character-confirm').disabled = !draft.every(Boolean);
      }
      overlay.querySelectorAll('[data-slot]').forEach(button => button.addEventListener('click', () => { side = Number(button.dataset.slot); render(); }));
      const inertElements = Array.from(document.body.children).filter(el => el instanceof HTMLElement && !el.inert && !['SCRIPT','STYLE','LINK'].includes(el.tagName));
      inertElements.forEach(el => { el.inert = true; });
      document.body.append(overlay); render();
      function finish(accepted) {
        if (accepted && !draft.every(Boolean)) return;
        clearDrag();
        if (accepted) {
          chosen = draft.slice(); apply();
          try { localStorage.setItem('dopanews_characters_v1', JSON.stringify(chosen)); } catch {}
        }
        global.removeEventListener('hashchange', cancel);
        overlay.remove(); inertElements.forEach(el => { el.inert = false; }); open = false;
        if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
        resolve(accepted);
      }
      const cancel = () => finish(false);
      overlay.querySelector('.character-select-back').addEventListener('click', cancel);
      overlay.querySelector('.character-confirm').addEventListener('click', () => finish(true));
      overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); cancel(); }
        if (event.key === 'Tab') {
          const buttons = Array.from(overlay.querySelectorAll('button'));
          if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
          else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
        }
      });
      global.addEventListener('hashchange', cancel);
      overlay.querySelector('.character-select-back').focus();
    });
  };
})(window);

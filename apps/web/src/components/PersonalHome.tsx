import { ChevronRight } from 'lucide-react';

import homeImage from '../assets/mysimple-home.jpg';
import logoImage from '../assets/mysimple-logo.png';
import { useWorkspace } from '../state/workspace';

export function PersonalHome() {
  const setActiveView = useWorkspace((state) => state.setActiveView);

  return (
    <section
      aria-label="Mysimple 个人主页"
      className="personal-home"
      style={{ backgroundImage: `url(${homeImage})` }}
    >
      <div className="personal-scene-label" aria-hidden="true">
        <span>WALLPAPER SCENE</span>
        <strong>M7 · TREE</strong>
        <small>2879168945</small>
      </div>
      <article className="personal-identity-card">
        <header className="personal-identity-heading">
          <img alt="Mysimple 的蜘蛛侠头像" className="personal-avatar" src={logoImage} />
          <div>
            <p>PERSONAL DESK</p>
            <h2>Mysimple</h2>
            <span>本地工作台</span>
          </div>
        </header>
        <p className="personal-intro">个人主页与 Whisper Subtitle Desk 的本地入口。</p>
        <dl className="personal-contact-list">
          <div>
            <dt>E-MAIL</dt>
            <dd>160334951@qq.com</dd>
          </div>
          <div>
            <dt>WECHAT</dt>
            <dd>h15875122478</dd>
          </div>
        </dl>
        <button
          className="personal-enter-button"
          onClick={() => setActiveView('workspace')}
          type="button"
        >
          <span>进入转录工作台</span>
          <ChevronRight size={18} />
        </button>
      </article>
    </section>
  );
}

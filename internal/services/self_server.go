package services

import (
	"self_server/internal/config"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type SelfServerService struct {
	App    *application.App
	Config *config.Config
}

func (s *SelfServerService) AppReady() {
	go func() {
		s.App.Event.Emit("update:projects", s.Config.Projects)
	}()
}
